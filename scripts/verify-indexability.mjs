import { isMain, optionalString, parseArgs, printErrors } from './lib/cli.mjs';
import { assertDeploymentEnvironment } from './lib/deployment-policy.mjs';
import {
  canonicalUrl,
  NOINDEX_ROUTES,
  PRODUCTION_ORIGIN,
  SITE_ROUTES,
} from './lib/site-contract.mjs';

const REQUEST_TIMEOUT_MS = 15_000;

export async function verifyIndexability({
  baseUrl,
  environment,
  checkWwwRedirect = environment === 'production',
}) {
  assertDeploymentEnvironment(environment);
  const origin = new URL(baseUrl).origin;
  const errors = [];
  const headers = { 'user-agent': 'TrinityLabs-DeploymentVerifier/1.0' };

  const robotsResponse = await safeFetch(new URL('/robots.txt', origin), { headers });
  if (!robotsResponse) {
    errors.push(`${origin}/robots.txt: request failed`);
  } else {
    const robots = await robotsResponse.text();
    if (!robotsResponse.ok) errors.push(`${origin}/robots.txt: HTTP ${robotsResponse.status}`);
    if (environment === 'production') {
      if (/^Disallow:\s*\/$/im.test(robots))
        errors.push('Production robots.txt blocks all crawling');
      if (
        !new RegExp(
          `^Sitemap:\\s*${escapeRegex(PRODUCTION_ORIGIN)}/sitemap-index\\.xml$`,
          'im',
        ).test(robots)
      ) {
        errors.push('Production robots.txt does not advertise the canonical sitemap');
      }
    } else if (!/^Disallow:\s*\/$/im.test(robots)) {
      errors.push('Preview robots.txt must disallow all crawling');
    }
  }

  const sitemapResponse = await safeFetch(new URL('/sitemap-index.xml', origin), { headers });
  if (!sitemapResponse) {
    errors.push(`${origin}/sitemap-index.xml: request failed`);
  } else if (environment === 'production' && !sitemapResponse.ok) {
    errors.push(`Production sitemap-index.xml returned HTTP ${sitemapResponse.status}`);
  } else if (environment === 'preview' && sitemapResponse.status !== 404) {
    errors.push(
      `Preview sitemap-index.xml must be absent (expected 404, received ${sitemapResponse.status})`,
    );
  }

  for (const route of SITE_ROUTES) {
    const response = await safeFetch(new URL(route, origin), { headers });
    if (!response) {
      errors.push(`${route}: request failed`);
      continue;
    }
    if (!response.ok) {
      errors.push(`${route}: HTTP ${response.status}`);
      continue;
    }

    const robotsHeader = response.headers.get('x-robots-tag') ?? '';
    if (
      environment === 'production' &&
      NOINDEX_ROUTES.includes(route) &&
      !/\bnoindex\b/i.test(robotsHeader)
    ) {
      errors.push(`${route}: controlled production response is missing X-Robots-Tag noindex`);
    }
    if (
      environment === 'production' &&
      !NOINDEX_ROUTES.includes(route) &&
      /\bnoindex\b/i.test(robotsHeader)
    ) {
      errors.push(`${route}: released production response has X-Robots-Tag noindex`);
    }
    if (environment === 'preview' && !/\bnoindex\b/i.test(robotsHeader)) {
      errors.push(`${route}: preview response is missing X-Robots-Tag noindex`);
    }

    const html = await response.text();
    const metaRobots = findMetaRobots(html);
    if (
      environment === 'production' &&
      NOINDEX_ROUTES.includes(route) &&
      !/\bnoindex\b/i.test(metaRobots ?? '')
    ) {
      errors.push(`${route}: controlled production HTML is missing a noindex meta directive`);
    }
    if (
      environment === 'production' &&
      !NOINDEX_ROUTES.includes(route) &&
      /\bnoindex\b/i.test(metaRobots ?? '')
    ) {
      errors.push(`${route}: released production HTML has a noindex meta directive`);
    }
    if (environment === 'preview' && !/\bnoindex\b/i.test(metaRobots ?? '')) {
      errors.push(`${route}: preview HTML is missing a noindex meta directive`);
    }
    const canonical = findCanonical(html);
    if (canonical !== canonicalUrl(route)) {
      errors.push(
        `${route}: canonical is '${canonical ?? 'missing'}', expected '${canonicalUrl(route)}'`,
      );
    }
  }

  if (checkWwwRedirect) {
    const probe = new URL('https://www.trinitylaboratories.org/records/?redirect-check=1');
    const response = await safeFetch(probe, { headers, redirect: 'manual' });
    const expectedLocation = `${PRODUCTION_ORIGIN}/records/?redirect-check=1`;
    if (!response) {
      errors.push('www redirect probe failed');
    } else {
      if (response.status !== 301)
        errors.push(`www redirect must return 301, received ${response.status}`);
      if (response.headers.get('location') !== expectedLocation) {
        errors.push(`www redirect must preserve path/query and target ${expectedLocation}`);
      }
    }
  }

  return errors;
}

async function safeFetch(url, init) {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
}

function findCanonical(html) {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = tag.match(/\brel\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
    if (!rel.toLowerCase().split(/\s+/).includes('canonical')) continue;
    return tag.match(/\bhref\s*=\s*["']([^"']*)["']/i)?.[1] ?? null;
  }
  return null;
}

function findMetaRobots(html) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const name = tag.match(/\bname\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
    if (name.toLowerCase() !== 'robots') continue;
    return tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1] ?? null;
  }
  return null;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = optionalString(args, 'url', '');
  const environment = optionalString(args, 'environment', 'production');
  if (!baseUrl) throw new Error('--url is required');

  const errors = await verifyIndexability({
    baseUrl,
    environment,
    checkWwwRedirect: environment === 'production' && !args.has('skip-www-redirect'),
  });
  printErrors('Deployment indexability violations:', errors);
  if (errors.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.log(`${environment} indexability checks passed for ${baseUrl}.`);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
