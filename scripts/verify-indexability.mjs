import { isMain, optionalString, parseArgs, printErrors } from './lib/cli.mjs';
import { assertDeploymentEnvironment } from './lib/deployment-policy.mjs';
import {
  canonicalUrl,
  NOINDEX_ROUTES,
  PRODUCTION_ORIGIN,
  SITEMAP_ROUTES,
  SITE_ROUTES,
} from './lib/site-contract.mjs';

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_CHILD_SITEMAPS = 16;

export async function verifyIndexability({
  baseUrl,
  environment,
  checkWwwRedirect = environment === 'production',
  fetchImplementation = fetch,
}) {
  assertDeploymentEnvironment(environment);
  const base = new URL(baseUrl);
  const origin = base.origin;
  const errors = [];
  const headers = { 'user-agent': 'TrinityLabs-DeploymentVerifier/1.0' };

  if (base.protocol !== 'https:') {
    errors.push(`Deployment verification requires HTTPS (received ${base.protocol})`);
  }
  if (environment === 'production' && origin !== PRODUCTION_ORIGIN) {
    errors.push(`Production verification must target the canonical apex ${PRODUCTION_ORIGIN}`);
  }
  if (errors.length > 0) return errors;

  const robotsUrl = new URL('/robots.txt', origin);
  const robotsResponse = await safeFetch(robotsUrl, { headers }, fetchImplementation);
  if (!robotsResponse) {
    errors.push(`${origin}/robots.txt: request failed`);
  } else {
    validateFinalUrl(robotsResponse, robotsUrl, errors, 'robots.txt');
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

  const sitemapUrl = new URL('/sitemap-index.xml', origin);
  const sitemapResponse = await safeFetch(sitemapUrl, { headers }, fetchImplementation);
  if (!sitemapResponse) {
    errors.push(`${origin}/sitemap-index.xml: request failed`);
  } else {
    validateFinalUrl(sitemapResponse, sitemapUrl, errors, 'sitemap-index.xml');
    if (environment === 'production' && !sitemapResponse.ok) {
      errors.push(`Production sitemap-index.xml returned HTTP ${sitemapResponse.status}`);
    } else if (environment === 'production') {
      await validateProductionSitemap({
        errors,
        fetchImplementation,
        headers,
        indexXml: await sitemapResponse.text(),
        origin,
      });
    } else if (environment === 'preview' && sitemapResponse.status !== 404) {
      errors.push(
        `Preview sitemap-index.xml must be absent (expected 404, received ${sitemapResponse.status})`,
      );
    }
  }

  for (const route of SITE_ROUTES) {
    const routeUrl = new URL(route, origin);
    const response = await safeFetch(routeUrl, { headers }, fetchImplementation);
    if (!response) {
      errors.push(`${route}: request failed`);
      continue;
    }
    validateFinalUrl(response, routeUrl, errors, route);
    if (!response.ok) {
      errors.push(`${route}: HTTP ${response.status}`);
      continue;
    }

    if (
      environment === 'production' &&
      route === '/' &&
      !/\bmax-age=\d+/i.test(response.headers.get('strict-transport-security') ?? '')
    ) {
      errors.push('/: production response is missing Strict-Transport-Security');
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
    const response = await safeFetch(probe, { headers, redirect: 'manual' }, fetchImplementation);
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

async function validateProductionSitemap({
  errors,
  fetchImplementation,
  headers,
  indexXml,
  origin,
}) {
  if (!/<sitemapindex\b/i.test(indexXml)) {
    errors.push('Production sitemap-index.xml must contain a sitemap index');
  }

  const childLocations = extractLocations(indexXml);
  if (childLocations.length === 0) {
    errors.push('Production sitemap-index.xml does not reference a child sitemap');
  }
  if (childLocations.length > MAX_CHILD_SITEMAPS) {
    errors.push(
      `Production sitemap-index.xml references ${childLocations.length} child sitemaps; maximum is ${MAX_CHILD_SITEMAPS}`,
    );
  }

  const expectedPublicUrls = new Set(SITEMAP_ROUTES.map(canonicalUrl));
  const controlledUrls = new Set(NOINDEX_ROUTES.map(canonicalUrl));
  const seenChildUrls = new Set();
  const seenPublicUrls = new Set();

  for (const location of childLocations.slice(0, MAX_CHILD_SITEMAPS)) {
    const childUrl = parseAbsoluteUrl(location, 'sitemap index', errors);
    if (!childUrl) continue;
    if (childUrl.origin !== origin) {
      errors.push(`Sitemap index references a foreign child sitemap: ${childUrl.href}`);
      continue;
    }
    if (seenChildUrls.has(childUrl.href)) {
      errors.push(`Sitemap index contains a duplicate child sitemap: ${childUrl.href}`);
      continue;
    }
    seenChildUrls.add(childUrl.href);

    const childResponse = await safeFetch(childUrl, { headers }, fetchImplementation);
    if (!childResponse) {
      errors.push(`Child sitemap request failed: ${childUrl.href}`);
      continue;
    }
    validateFinalUrl(childResponse, childUrl, errors, `child sitemap ${childUrl.pathname}`);
    if (!childResponse.ok) {
      errors.push(`Child sitemap returned HTTP ${childResponse.status}: ${childUrl.href}`);
      continue;
    }

    const childXml = await childResponse.text();
    if (!/<urlset\b/i.test(childXml)) {
      errors.push(`Child sitemap must contain a URL set: ${childUrl.href}`);
    }
    for (const publicLocation of extractLocations(childXml)) {
      const publicUrl = parseAbsoluteUrl(publicLocation, childUrl.href, errors);
      if (!publicUrl) continue;
      if (publicUrl.origin !== origin) {
        errors.push(`Sitemap contains a foreign public URL: ${publicUrl.href}`);
        continue;
      }
      if (seenPublicUrls.has(publicUrl.href)) {
        errors.push(`Sitemap contains a duplicate public URL: ${publicUrl.href}`);
        continue;
      }
      seenPublicUrls.add(publicUrl.href);

      if (
        controlledUrls.has(publicUrl.href) ||
        /^\/(?:portal|records)(?:\/|$)/i.test(publicUrl.pathname)
      ) {
        errors.push(`Sitemap contains a controlled URL: ${publicUrl.href}`);
      } else if (!expectedPublicUrls.has(publicUrl.href)) {
        errors.push(`Sitemap contains an unexpected public URL: ${publicUrl.href}`);
      }
    }
  }

  for (const expectedUrl of expectedPublicUrls) {
    if (!seenPublicUrls.has(expectedUrl)) {
      errors.push(`Sitemap is missing required public URL: ${expectedUrl}`);
    }
  }
}

function extractLocations(xml) {
  return [...xml.matchAll(/<loc\b[^>]*>\s*([\s\S]*?)\s*<\/loc>/gi)].map((match) =>
    decodeXmlText(match[1]).trim(),
  );
}

export function decodeXmlText(value) {
  const entityValues = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&apos;': "'",
  };
  return value.replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => entityValues[entity]);
}

function parseAbsoluteUrl(value, source, errors) {
  try {
    return new URL(value);
  } catch {
    errors.push(`${source} contains an invalid absolute URL: ${value || '(empty)'}`);
    return null;
  }
}

function validateFinalUrl(response, requestedUrl, errors, label) {
  let finalUrl;
  try {
    finalUrl = new URL(response.url);
  } catch {
    errors.push(`${label}: response did not report a valid final URL`);
    return;
  }

  if (finalUrl.protocol !== 'https:') {
    errors.push(`${label}: final response did not use HTTPS (${finalUrl.href})`);
  }
  if (finalUrl.origin !== requestedUrl.origin) {
    errors.push(`${label}: redirected outside the verified origin (${finalUrl.href})`);
  }
  if (
    `${finalUrl.pathname}${finalUrl.search}` !== `${requestedUrl.pathname}${requestedUrl.search}`
  ) {
    errors.push(`${label}: redirected away from the canonical route (${finalUrl.href})`);
  }
}

async function safeFetch(url, init, fetchImplementation) {
  try {
    return await fetchImplementation(url, {
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
