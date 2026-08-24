import { expect, test } from '@playwright/test';
import { SITE_ROUTES, visit } from './support/site';

test.describe('privacy and local assets', () => {
  for (const route of SITE_ROUTES) {
    test(`${route} performs no third-party requests or persistent tracking`, async ({
      context,
      page,
    }) => {
      const remoteRequests: string[] = [];
      page.on('request', (request) => {
        const target = new URL(request.url());
        const base = new URL(page.url() === 'about:blank' ? request.url() : page.url());
        if (/^https?:$/.test(target.protocol) && target.origin !== base.origin) {
          remoteRequests.push(request.url());
        }
      });

      await visit(page, route);
      expect(remoteRequests).toEqual([]);
      expect(await context.cookies()).toEqual([]);
      expect(await page.evaluate(() => navigator.serviceWorker?.controller ?? null)).toBeNull();
      expect(
        await page.evaluate(() => ({
          dataLayer: 'dataLayer' in window,
          ga: 'ga' in window,
          plausible: 'plausible' in window,
          posthog: 'posthog' in window,
        })),
      ).toEqual({ dataLayer: false, ga: false, plausible: false, posthog: false });

      const externalAssets = await page
        .locator(
          'script[src], img[src], iframe[src], source[src], video[src], audio[src], link[rel="stylesheet"][href], link[rel~="icon"][href]',
        )
        .evaluateAll((elements) => {
          const pageOrigin = location.origin;
          return elements
            .map((element) => element.getAttribute('src') ?? element.getAttribute('href') ?? '')
            .filter(Boolean)
            .map((value) => new URL(value, location.href))
            .filter((url) => /^https?:$/.test(url.protocol) && url.origin !== pageOrigin)
            .map((url) => url.href);
        });
      expect(externalAssets).toEqual([]);
    });
  }
});
