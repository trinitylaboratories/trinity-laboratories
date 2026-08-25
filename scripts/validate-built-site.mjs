import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isMain, optionalString, parseArgs, printErrors } from './lib/cli.mjs';
import {
  buildHeaders,
  buildRobots,
  extractInlineScriptHashes,
  inferDeploymentEnvironment,
} from './lib/deployment-policy.mjs';
import { pathExists, walkFiles } from './lib/filesystem.mjs';
import {
  canonicalUrl,
  FORM_IDS,
  GATEWAY_ROUTE,
  LOCAL_FORM_ROUTES,
  NOINDEX_ROUTES,
  PRODUCTION_ORIGIN,
  REQUIRED_GATEWAY_HOOKS,
  REQUIRED_SESSION_HOOKS,
  routeToOutputPath,
  SEARCHABLE_RECORD_ROUTES,
  SITEMAP_ROUTES,
  SITE_ROUTES,
} from './lib/site-contract.mjs';

const TRACKER_PATTERN =
  /(?:google-analytics\.com|googletagmanager\.com|plausible\.io|posthog|hotjar|clarity\.ms|connect\.facebook\.net|mixpanel|segment\.com)/i;

const SCRIPT_PRIVACY_PATTERNS = Object.freeze([
  ['cookie access', /\bdocument\.cookie\b/],
  ['beacon transmission', /\bnavigator\.sendBeacon\b/],
  ['WebSocket connection', /\bnew\s+WebSocket\s*\(/],
  ['EventSource connection', /\bnew\s+EventSource\s*\(/],
  ['remote fetch', /\bfetch\s*\(\s*["'`]https?:\/\//],
]);

export function getAttribute(tag, attribute) {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tag.match(
    new RegExp(`(?:^|\\s)${escaped}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+)))?`, 'i'),
  );
  if (!match) return undefined;
  return match[1] ?? match[2] ?? match[3] ?? '';
}

export function hasAttribute(tag, attribute) {
  return getAttribute(tag, attribute) !== undefined;
}

export function extractTags(html, tagName) {
  return [...html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, 'gi'))].map((match) => match[0]);
}

export function extractForms(html) {
  return [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)].map((match) => match[0]);
}

export function validateHtmlPage(html, route, { environment = 'production' } = {}) {
  const errors = [];
  const htmlTag = extractTags(html, 'html')[0] ?? '';
  const title = decodeText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const metaTags = extractTags(html, 'meta');
  const linkTags = extractTags(html, 'link');
  const canonicalTag = linkTags.find((tag) =>
    (getAttribute(tag, 'rel') ?? '').toLowerCase().split(/\s+/).includes('canonical'),
  );
  const descriptionTag = metaTags.find(
    (tag) => (getAttribute(tag, 'name') ?? '').toLowerCase() === 'description',
  );
  const robotsTag = metaTags.find(
    (tag) => (getAttribute(tag, 'name') ?? '').toLowerCase() === 'robots',
  );

  if (!getAttribute(htmlTag, 'lang')) errors.push(`${route}: html must declare a lang attribute`);
  const maximumTitleLength = route.startsWith('/records/') ? 120 : 70;
  if (title.length < 8 || title.length > maximumTitleLength) {
    errors.push(`${route}: title must be between 8 and ${maximumTitleLength} characters`);
  }
  const description = getAttribute(descriptionTag ?? '', 'content')?.trim() ?? '';
  if (description.length < 40 || description.length > 180) {
    errors.push(`${route}: meta description must be between 40 and 180 characters`);
  }
  if (getAttribute(canonicalTag ?? '', 'href') !== canonicalUrl(route)) {
    errors.push(`${route}: canonical must be ${canonicalUrl(route)}`);
  }
  const robotsContent = getAttribute(robotsTag ?? '', 'content') ?? '';
  if (
    environment === 'production' &&
    NOINDEX_ROUTES.includes(route) &&
    !/\bnoindex\b/i.test(robotsContent)
  ) {
    errors.push(`${route}: controlled production HTML must contain a noindex meta directive`);
  } else if (
    environment === 'production' &&
    !NOINDEX_ROUTES.includes(route) &&
    /\bnoindex\b/i.test(robotsContent)
  ) {
    errors.push(`${route}: released production HTML must not contain a noindex meta directive`);
  } else if (environment === 'preview' && !/\bnoindex\b/i.test(robotsContent)) {
    errors.push(`${route}: preview HTML must contain a noindex meta directive`);
  }
  if (/<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i.test(html)) {
    errors.push(`${route}: meta refresh redirects are prohibited`);
  }
  if (extractTags(html, 'main').length !== 1)
    errors.push(`${route}: expected exactly one main element`);
  if (extractTags(html, 'h1').length !== 1)
    errors.push(`${route}: expected exactly one h1 element`);

  for (const imgTag of extractTags(html, 'img')) {
    if (!hasAttribute(imgTag, 'alt')) errors.push(`${route}: every image must declare alt text`);
  }

  if (TRACKER_PATTERN.test(html))
    errors.push(`${route}: tracking/analytics resources are prohibited`);
  errors.push(...validateResourceOrigins(html, route));
  errors.push(...validateForms(html, route));

  if (LOCAL_FORM_ROUTES.includes(route) && !/\bdata-local-form(?:\s|=|>)/i.test(html)) {
    errors.push(`${route}: missing [data-local-form]`);
  }

  if (route === GATEWAY_ROUTE) {
    for (const hook of REQUIRED_GATEWAY_HOOKS) {
      if (!new RegExp(`\\b${hook}(?:\\s|=|>)`, 'i').test(html)) {
        errors.push(`${route}: missing [${hook}]`);
      }
    }
  }

  if (route.startsWith('/records/')) {
    for (const hook of REQUIRED_SESSION_HOOKS) {
      if (!new RegExp(`\\b${hook}(?:\\s|=|>)`, 'i').test(html)) {
        errors.push(`${route}: missing [${hook}]`);
      }
    }
  }

  return errors;
}

export function validateForms(html, route) {
  const errors = [];
  for (const form of extractForms(html)) {
    const openingTag = form.match(/^<form\b[^>]*>/i)?.[0] ?? '';
    const action = getAttribute(openingTag, 'action');
    if (action && action !== '#') {
      errors.push(`${route}: forms must not declare a network action (${action})`);
    }

    if (
      hasAttribute(openingTag, 'data-local-form') ||
      hasAttribute(openingTag, 'data-gateway-form') ||
      hasAttribute(openingTag, 'data-authorization-form')
    ) {
      if (hasAttribute(openingTag, 'action')) {
        errors.push(`${route}: local-only forms must omit the action attribute`);
      }
      if (hasAttribute(openingTag, 'method')) {
        errors.push(`${route}: local-only forms must omit the method attribute`);
      }
      for (const fieldTag of [
        ...extractTags(form, 'input'),
        ...extractTags(form, 'select'),
        ...extractTags(form, 'textarea'),
      ]) {
        if (hasAttribute(fieldTag, 'name')) {
          errors.push(`${route}: local-only form controls must not have name attributes`);
        }
      }
    }
  }
  return errors;
}

export function validateResourceOrigins(html, route) {
  const errors = [];
  const tags = ['script', 'img', 'iframe', 'source', 'video', 'audio', 'link'];
  const attributes = ['src', 'href', 'poster'];

  for (const tagName of tags) {
    for (const tag of extractTags(html, tagName)) {
      for (const attribute of attributes) {
        const value = getAttribute(tag, attribute);
        if (!value || !/^https?:\/\//i.test(value)) continue;
        if (new URL(value).origin !== PRODUCTION_ORIGIN) {
          errors.push(`${route}: remote ${tagName} ${attribute} is prohibited (${value})`);
        }
      }

      const srcset = getAttribute(tag, 'srcset');
      if (srcset) {
        for (const candidate of srcset.split(',')) {
          const value = candidate.trim().split(/\s+/)[0];
          if (/^https?:\/\//i.test(value) && new URL(value).origin !== PRODUCTION_ORIGIN) {
            errors.push(`${route}: remote srcset asset is prohibited (${value})`);
          }
        }
      }
    }
  }

  return errors;
}

export function validateScriptPrivacy(source, fileName) {
  const errors = [];
  if (TRACKER_PATTERN.test(source))
    errors.push(`${fileName}: tracking/analytics code is prohibited`);
  for (const [label, pattern] of SCRIPT_PRIVACY_PATTERNS) {
    if (pattern.test(source)) errors.push(`${fileName}: ${label} is prohibited`);
  }
  return errors;
}

export async function validatePagefindOutput(distRoot) {
  const errors = [];
  const pagefindRoot = path.join(distRoot, 'pagefind');
  const entryPath = path.join(pagefindRoot, 'pagefind-entry.json');
  if (!(await pathExists(path.join(pagefindRoot, 'pagefind.js')))) {
    errors.push('Pagefind output is missing pagefind/pagefind.js');
  }
  if (!(await pathExists(entryPath))) {
    errors.push('Pagefind output is missing pagefind/pagefind-entry.json');
    return errors;
  }

  try {
    const entry = JSON.parse(await readFile(entryPath, 'utf8'));
    const languages = Object.values(entry.languages ?? {});
    const indexedPages = languages.reduce(
      (total, language) =>
        total + (Number.isInteger(language?.page_count) ? language.page_count : 0),
      0,
    );
    if (indexedPages < SEARCHABLE_RECORD_ROUTES.length) {
      errors.push(
        `Pagefind reports only ${indexedPages} indexed page(s); expected at least ${SEARCHABLE_RECORD_ROUTES.length} searchable records`,
      );
    }
  } catch (error) {
    errors.push(
      `pagefind/pagefind-entry.json: ${error instanceof Error ? error.message : 'invalid JSON'}`,
    );
  }

  const pagefindFiles = await walkFiles(pagefindRoot, { ignoredDirectories: new Set() });
  if (!pagefindFiles.some((file) => file.endsWith('.pf_index'))) {
    errors.push('Pagefind output contains no search index chunks');
  }
  if (!pagefindFiles.some((file) => file.endsWith('.pf_fragment'))) {
    errors.push('Pagefind output contains no indexed document fragments');
  }

  for (const route of SEARCHABLE_RECORD_ROUTES) {
    const outputPath = path.join(distRoot, routeToOutputPath(route));
    const html = await readFile(outputPath, 'utf8').catch(() => '');
    if (!/\bdata-pagefind-body(?:\s|=|>)/i.test(html)) {
      errors.push(`${route}: canonical record is not marked as Pagefind index content`);
    }
  }
  return errors;
}

export function extractSitemapLocations(source) {
  return [...source.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)].map((match) =>
    match[1]
      .replaceAll('&amp;', '&')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&apos;', "'")
      .trim(),
  );
}

export function validateSitemapDocuments(documents) {
  const locations = new Set(documents.flatMap(extractSitemapLocations));
  const errors = [];
  for (const route of SITEMAP_ROUTES) {
    const canonical = canonicalUrl(route);
    if (!locations.has(canonical))
      errors.push(`Sitemap is missing required canonical URL: ${canonical}`);
  }
  for (const route of NOINDEX_ROUTES) {
    const canonical = canonicalUrl(route);
    if (locations.has(canonical))
      errors.push(`Sitemap must exclude controlled canonical URL: ${canonical}`);
  }
  return errors;
}

export function validateHeadersLimits(source) {
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  const ruleCount = lines.filter(
    (line) => line.trim() !== '' && !line.trimStart().startsWith('#') && !/^\s/.test(line),
  ).length;
  const longestLineLength = lines.reduce((longest, line) => Math.max(longest, line.length), 0);
  const errors = [];

  for (const [index, line] of lines.entries()) {
    if (line.length > 2_000) {
      errors.push(`_headers line ${index + 1} is ${line.length} characters; maximum is 2000`);
    }
  }
  if (ruleCount > 100) {
    errors.push(`_headers contains ${ruleCount} rules; maximum is 100`);
  }

  return { errors, longestLineLength, ruleCount };
}

export async function validateBuiltSite({ dist = 'dist', environment = 'production' } = {}) {
  const distRoot = path.resolve(dist);
  const errors = [];

  if (!(await pathExists(distRoot))) {
    return { errors: [`Build directory does not exist: ${distRoot}`], pageCount: 0 };
  }

  const htmlByRoute = new Map();
  for (const route of SITE_ROUTES) {
    const outputPath = path.join(distRoot, routeToOutputPath(route));
    if (!(await pathExists(outputPath))) {
      errors.push(`${route}: missing built page (${path.relative(process.cwd(), outputPath)})`);
      continue;
    }
    const html = await readFile(outputPath, 'utf8');
    htmlByRoute.set(route, html);
    errors.push(...validateHtmlPage(html, route, { environment }));
  }

  for (const formId of FORM_IDS) {
    const route = `/records/forms/${formId}/`;
    const html = htmlByRoute.get(route);
    if (html && !html.toLowerCase().includes(formId)) {
      errors.push(`${route}: built form page does not identify ${formId}`);
    }
  }

  for (const [route, html] of htmlByRoute) {
    errors.push(...(await validateInternalLinks(html, route, distRoot)));
  }

  const allFiles = await walkFiles(distRoot, { ignoredDirectories: new Set() });
  for (const relativeFile of allFiles.filter((file) => /\.(?:js|mjs)$/i.test(file))) {
    const source = await readFile(path.join(distRoot, relativeFile), 'utf8');
    errors.push(...validateScriptPrivacy(source, relativeFile));
  }
  errors.push(...(await validatePagefindOutput(distRoot)));

  const scriptHashes = new Set();
  for (const relativeFile of allFiles.filter((file) => /\.html$/i.test(file))) {
    const html = await readFile(path.join(distRoot, relativeFile), 'utf8');
    for (const hash of extractInlineScriptHashes(html)) scriptHashes.add(hash);
  }
  const expectedHeaders = buildHeaders(environment, { scriptHashes: [...scriptHashes] });
  const actualHeaders = await readFile(path.join(distRoot, '_headers'), 'utf8').catch(() => '');
  if (actualHeaders !== expectedHeaders) {
    errors.push(`_headers does not match the generated ${environment} deployment policy`);
  }
  const headerMetrics = validateHeadersLimits(actualHeaders);
  errors.push(...headerMetrics.errors);

  const expectedRobots = buildRobots(environment);
  const actualRobots = await readFile(path.join(distRoot, 'robots.txt'), 'utf8').catch(() => '');
  if (actualRobots !== expectedRobots) {
    errors.push(`robots.txt does not match the generated ${environment} deployment policy`);
  }

  if (environment === 'production') {
    const sitemapIndexPath = path.join(distRoot, 'sitemap-index.xml');
    if (!(await pathExists(sitemapIndexPath))) {
      errors.push('Production build is missing sitemap-index.xml');
    } else {
      const sitemapFiles = allFiles.filter((file) => /^sitemap.*\.xml$/i.test(path.basename(file)));
      const sitemapDocuments = await Promise.all(
        sitemapFiles.map((file) => readFile(path.join(distRoot, file), 'utf8')),
      );
      errors.push(...validateSitemapDocuments(sitemapDocuments));
    }
  } else {
    if (
      !/X-Robots-Tag:\s*noindex/i.test(actualHeaders) ||
      !/^Disallow:\s*\/$/im.test(actualRobots)
    ) {
      errors.push('Preview build must be blocked by both X-Robots-Tag and robots.txt');
    }
    const sitemapFiles = allFiles.filter((file) => /^sitemap.*\.xml$/i.test(path.basename(file)));
    if (sitemapFiles.length > 0) {
      errors.push(`Preview build must not contain sitemap XML (${sitemapFiles.join(', ')})`);
    }
  }

  return { errors: [...new Set(errors)], pageCount: htmlByRoute.size, headerMetrics };
}

async function validateInternalLinks(html, route, distRoot) {
  const errors = [];
  const hrefs = extractTags(html, 'a')
    .map((tag) => getAttribute(tag, 'href'))
    .filter(Boolean);

  for (const href of hrefs) {
    if (/^(?:#|mailto:|tel:|javascript:)/i.test(href)) continue;

    let target;
    try {
      target = new URL(href, canonicalUrl(route));
    } catch {
      errors.push(`${route}: invalid link URL (${href})`);
      continue;
    }

    if (target.origin !== PRODUCTION_ORIGIN) continue;
    const pathname = decodeURIComponent(target.pathname);
    const outputPath = /\.[a-z0-9]+$/i.test(pathname)
      ? path.join(distRoot, pathname.slice(1))
      : path.join(distRoot, routeToOutputPath(pathname));
    if (!(await pathExists(outputPath))) errors.push(`${route}: broken internal link (${href})`);
  }

  return errors;
}

function decodeText(value) {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:amp|#38);/gi, '&')
    .replace(/&(?:quot|#34);/gi, '"')
    .replace(/&(?:apos|#39);/gi, "'")
    .replace(/&(?:lt|#60);/gi, '<')
    .replace(/&(?:gt|#62);/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dist = optionalString(args, 'dist', 'dist');
  const environment = optionalString(args, 'environment', '') || inferDeploymentEnvironment();
  const result = await validateBuiltSite({ dist, environment });
  printErrors('Built-site policy violations:', result.errors);

  if (result.errors.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.log(
    `Built-site policy passed for ${result.pageCount} required route(s); _headers has ${result.headerMetrics.ruleCount} rule(s), longest line ${result.headerMetrics.longestLineLength}/2000 characters.`,
  );
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
