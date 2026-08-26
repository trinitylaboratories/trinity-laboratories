import { describe, expect, it } from 'vitest';

import { decodeXmlText, verifyIndexability } from '../../scripts/verify-indexability.mjs';
import {
  canonicalUrl,
  NOINDEX_ROUTES,
  PRODUCTION_ORIGIN,
  SITEMAP_ROUTES,
  SITE_ROUTES,
} from '../../scripts/lib/site-contract.mjs';

type FetchOptions = {
  missingHsts?: boolean;
  redirectRoute?: string;
  sitemapChildLocations?: string[];
  sitemapPublicLocations?: string[];
  tamperControlledRoute?: string;
  wwwLocation?: string;
  wwwStatus?: number;
};

function fakeResponse(
  url: string,
  body: string,
  { headers = {}, status = 200 }: { headers?: Record<string, string>; status?: number } = {},
): Response {
  const response = new Response(body, { headers, status });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

function productionFetch(options: FetchOptions = {}): typeof fetch {
  return async (input: RequestInfo | URL) => {
    const url = new URL(String(input));

    if (url.hostname === 'www.trinitylaboratories.org') {
      return fakeResponse(url.href, '', {
        headers: {
          location: options.wwwLocation ?? `${PRODUCTION_ORIGIN}/records/?redirect-check=1`,
        },
        status: options.wwwStatus ?? 301,
      });
    }

    if (url.pathname === '/robots.txt') {
      return fakeResponse(
        url.href,
        `User-agent: *\nAllow: /\nSitemap: ${PRODUCTION_ORIGIN}/sitemap-index.xml\n`,
      );
    }
    if (url.pathname === '/sitemap-index.xml') {
      const locations = options.sitemapChildLocations ?? [`${PRODUCTION_ORIGIN}/sitemap-0.xml`];
      return fakeResponse(
        url.href,
        `<sitemapindex>${locations
          .map((location) => `<sitemap><loc>${location}</loc></sitemap>`)
          .join('')}</sitemapindex>`,
      );
    }
    if (url.pathname === '/sitemap-0.xml') {
      const locations = options.sitemapPublicLocations ?? SITEMAP_ROUTES.map(canonicalUrl);
      return fakeResponse(
        url.href,
        `<urlset>${locations
          .map((location) => `<url><loc>${location}</loc></url>`)
          .join('')}</urlset>`,
      );
    }

    const route = url.pathname;
    const controlled = NOINDEX_ROUTES.includes(route);
    const tampered = options.tamperControlledRoute === route;
    const metaRobots = controlled && !tampered ? 'noindex, nofollow' : 'index, follow';
    const canonical = tampered ? `${PRODUCTION_ORIGIN}/wrong/` : canonicalUrl(route);
    const headers: Record<string, string> = {};
    if (controlled && !tampered) headers['x-robots-tag'] = 'noindex, nofollow';
    if (route === '/' && !options.missingHsts) {
      headers['strict-transport-security'] = 'max-age=31536000';
    }
    const finalUrl = options.redirectRoute === route ? 'http://example.test/redirected/' : url.href;

    return fakeResponse(
      finalUrl,
      `<html><head><meta name="robots" content="${metaRobots}"><link rel="canonical" href="${canonical}"></head></html>`,
      { headers },
    );
  };
}

describe('external production verifier', () => {
  it('decodes XML entities exactly once', () => {
    expect(decodeXmlText('&amp;&lt;&gt;&quot;&apos;')).toBe('&<>"\'');
    expect(decodeXmlText('&amp;lt;')).toBe('&lt;');
  });

  it('accepts a healthy HTTPS apex deployment and permanent www redirect', async () => {
    await expect(
      verifyIndexability({
        baseUrl: PRODUCTION_ORIGIN,
        environment: 'production',
        fetchImplementation: productionFetch(),
      }),
    ).resolves.toEqual([]);
  });

  it('refuses insecure or noncanonical production targets before making requests', async () => {
    const noFetch = async () => {
      throw new Error('fetch should not run for an invalid target');
    };
    await expect(
      verifyIndexability({
        baseUrl: 'http://trinitylaboratories.org',
        environment: 'production',
        fetchImplementation: noFetch,
      }),
    ).resolves.toEqual(expect.arrayContaining([expect.stringMatching(/requires HTTPS/)]));
    await expect(
      verifyIndexability({
        baseUrl: 'https://example.test',
        environment: 'production',
        fetchImplementation: noFetch,
      }),
    ).resolves.toEqual(expect.arrayContaining([expect.stringMatching(/canonical apex/)]));
  });

  it('detects transport, apex, and redirect regressions', async () => {
    const errors = await verifyIndexability({
      baseUrl: PRODUCTION_ORIGIN,
      environment: 'production',
      fetchImplementation: productionFetch({
        missingHsts: true,
        redirectRoute: '/',
        wwwLocation: 'https://example.test/records/',
        wwwStatus: 302,
      }),
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/final response did not use HTTPS/),
        expect.stringMatching(/redirected outside the verified origin/),
        expect.stringMatching(/missing Strict-Transport-Security/),
        expect.stringMatching(/www redirect must return 301/),
        expect.stringMatching(/www redirect must preserve path\/query/),
      ]),
    );
  });

  it('detects controlled-route indexing and canonical regressions', async () => {
    const controlledRoute = NOINDEX_ROUTES[0];
    expect(SITE_ROUTES).toContain(controlledRoute);

    const errors = await verifyIndexability({
      baseUrl: PRODUCTION_ORIGIN,
      environment: 'production',
      fetchImplementation: productionFetch({ tamperControlledRoute: controlledRoute }),
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/missing X-Robots-Tag noindex/),
        expect.stringMatching(/missing a noindex meta directive/),
        expect.stringMatching(/canonical is/),
      ]),
    );
  });

  it('rejects missing, duplicate, controlled, foreign, and unexpected sitemap URLs', async () => {
    const missing = canonicalUrl(SITEMAP_ROUTES[0]);
    const duplicate = canonicalUrl(SITEMAP_ROUTES[1]);
    const controlled = canonicalUrl(NOINDEX_ROUTES[0]);
    const foreign = 'https://example.test/public/';
    const unexpected = `${PRODUCTION_ORIGIN}/not-in-the-public-contract/`;
    const publicLocations = SITEMAP_ROUTES.slice(1).map(canonicalUrl);
    publicLocations.push(duplicate, controlled, foreign, unexpected);

    const errors = await verifyIndexability({
      baseUrl: PRODUCTION_ORIGIN,
      environment: 'production',
      fetchImplementation: productionFetch({ sitemapPublicLocations: publicLocations }),
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        `Sitemap is missing required public URL: ${missing}`,
        `Sitemap contains a duplicate public URL: ${duplicate}`,
        `Sitemap contains a controlled URL: ${controlled}`,
        `Sitemap contains a foreign public URL: ${foreign}`,
        `Sitemap contains an unexpected public URL: ${unexpected}`,
      ]),
    );
  });

  it('fetches only unique same-origin child sitemaps', async () => {
    const child = `${PRODUCTION_ORIGIN}/sitemap-0.xml`;
    const foreignChild = 'https://example.test/sitemap.xml';
    const errors = await verifyIndexability({
      baseUrl: PRODUCTION_ORIGIN,
      environment: 'production',
      fetchImplementation: productionFetch({
        sitemapChildLocations: [child, child, foreignChild],
      }),
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        `Sitemap index contains a duplicate child sitemap: ${child}`,
        `Sitemap index references a foreign child sitemap: ${foreignChild}`,
      ]),
    );
  });
});
