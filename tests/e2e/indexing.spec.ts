import { expect, test } from '@playwright/test';
import { canonicalUrl, CONTROLLED_ROUTES, SITE_ROUTES, visit } from './support/site';

const deploymentEnvironment =
  process.env.SITE_DEPLOYMENT_ENV === 'preview' ? 'preview' : 'production';

test.describe(`indexing contract (${deploymentEnvironment})`, () => {
  for (const route of SITE_ROUTES) {
    test(`${route} has the canonical apex URL`, async ({ page }) => {
      const response = await visit(page, route);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        'href',
        canonicalUrl(route),
      );

      const robotsMeta = page.locator('meta[name="robots"]');
      const metaRobots =
        (await robotsMeta.count()) > 0
          ? ((await robotsMeta.first().getAttribute('content')) ?? '')
          : '';
      const robotsHeader = response.headers()['x-robots-tag'] ?? '';
      if (deploymentEnvironment === 'preview') {
        expect(metaRobots.toLowerCase()).toContain('noindex');
        if (!['127.0.0.1', 'localhost'].includes(new URL(page.url()).hostname)) {
          expect(robotsHeader.toLowerCase()).toContain('noindex');
        }
      } else if (CONTROLLED_ROUTES.includes(route as (typeof CONTROLLED_ROUTES)[number])) {
        expect(metaRobots.toLowerCase()).toContain('noindex');
        if (!['127.0.0.1', 'localhost'].includes(new URL(page.url()).hostname)) {
          expect(robotsHeader.toLowerCase()).toContain('noindex');
        }
      } else {
        expect(metaRobots.toLowerCase()).not.toContain('noindex');
        expect(robotsHeader.toLowerCase()).not.toContain('noindex');
      }
    });
  }

  test('robots and sitemap exposure match the deployment environment', async ({ request }) => {
    const robots = await request.get('/robots.txt');
    expect(robots.status()).toBe(200);
    const robotsText = await robots.text();
    const sitemap = await request.get('/sitemap-index.xml');

    if (deploymentEnvironment === 'preview') {
      expect(robotsText).toMatch(/^User-agent:\s*\*\s*\nDisallow:\s*\/\s*$/i);
      expect(sitemap.status()).toBe(404);
    } else {
      expect(robotsText).toContain('Allow: /');
      expect(robotsText).toContain('Sitemap: https://trinitylaboratories.org/sitemap-index.xml');
      expect(sitemap.status()).toBe(200);
      const sitemapIndex = await sitemap.text();
      const childPaths = [...sitemapIndex.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
        ([, location]) => new URL(location).pathname,
      );
      const childDocuments = await Promise.all(
        childPaths.map(async (path) => (await request.get(path)).text()),
      );
      const publishedLocations = childDocuments.join('\n');
      for (const route of CONTROLLED_ROUTES) {
        expect(publishedLocations).not.toContain(canonicalUrl(route));
      }
    }
  });
});
