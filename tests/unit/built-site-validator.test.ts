import { describe, expect, it } from 'vitest';
import {
  getAttribute,
  extractSitemapLocations,
  validateForms,
  validateHtmlPage,
  validateHeadersLimits,
  validateResourceOrigins,
  validateSitemapDocuments,
  validateScriptPrivacy,
} from '../../scripts/validate-built-site.mjs';
import { canonicalUrl, NOINDEX_ROUTES, SITEMAP_ROUTES } from '../../scripts/lib/site-contract.mjs';

function validPage(route = '/contact/') {
  return `<!doctype html>
    <html lang="en"><head>
      <title>Contact | Trinity Laboratories</title>
      <meta name="description" content="Direct an institutional inquiry to the appropriate Trinity Laboratories team." />
      <meta name="robots" content="index, follow" />
      <link rel="canonical" href="https://trinitylaboratories.org${route}" />
    </head><body><main><h1>Contact Trinity Laboratories</h1>
      <form data-local-form><input id="message" /><button type="submit">Send</button></form>
    </main></body></html>`;
}

describe('built HTML validation', () => {
  it('accepts a local, canonical, accessible page shell', () => {
    expect(validateHtmlPage(validPage(), '/contact/')).toEqual([]);
  });

  it('preserves complete institutional record titles while keeping corporate titles concise', () => {
    const longTitle =
      'TL-SEC-001 Reference — Endorsements & Facility Conditions | Trinity Institutional Records Network';
    const record = validPage('/records/security/endorsements-and-conditions/')
      .replace('Contact | Trinity Laboratories', longTitle)
      .replace(
        '<main>',
        '<span data-session-state></span><button data-session-terminate></button><main>',
      );
    expect(validateHtmlPage(record, '/records/security/endorsements-and-conditions/')).toEqual([]);
    expect(
      validateHtmlPage(
        validPage().replace('Contact | Trinity Laboratories', 'x'.repeat(71)),
        '/contact/',
      ),
    ).toEqual([expect.stringMatching(/between 8 and 70/)]);
  });

  it('requires opposite HTML indexing directives for production and previews', () => {
    const previewPage = validPage().replace('index, follow', 'noindex, nofollow');
    expect(validateHtmlPage(previewPage, '/contact/', { environment: 'preview' })).toEqual([]);
    expect(validateHtmlPage(previewPage, '/contact/')).toEqual([
      expect.stringMatching(/production HTML must not contain/),
    ]);
    expect(validateHtmlPage(validPage(), '/contact/', { environment: 'preview' })).toEqual([
      expect.stringMatching(/preview HTML must contain/),
    ]);

    const controlledPage = validPage('/portal/').replace('index, follow', 'noindex, nofollow');
    expect(validateHtmlPage(controlledPage, '/portal/')).toEqual([]);
    expect(validateHtmlPage(validPage('/portal/'), '/portal/')).toEqual([
      expect.stringMatching(/controlled production HTML must contain/),
    ]);
  });

  it('rejects network-capable local forms', () => {
    const html = '<form data-local-form action="https://example.test"><input name="email"></form>';
    expect(validateForms(html, '/contact/')).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/network action/),
        expect.stringMatching(/name attributes/),
      ]),
    );
  });

  it('rejects third-party resources and transmission APIs', () => {
    expect(
      validateResourceOrigins('<script src="https://example.test/app.js"></script>', '/'),
    ).toEqual([expect.stringMatching(/remote script src/)]);
    expect(validateScriptPrivacy('navigator.' + 'sendBeacon("/event")', 'app.js')).toEqual([
      expect.stringMatching(/beacon transmission/),
    ]);
  });

  it('parses quoted, unquoted, and boolean attributes', () => {
    expect(getAttribute('<input id="a" required data-state=ready>', 'id')).toBe('a');
    expect(getAttribute('<input id="a" required data-state=ready>', 'required')).toBe('');
    expect(getAttribute('<input id="a" required data-state=ready>', 'data-state')).toBe('ready');
  });

  it('requires every canonical site route in production sitemap documents', () => {
    const complete = `<urlset>${SITEMAP_ROUTES.map(
      (route) => `<url><loc>${canonicalUrl(route)}</loc></url>`,
    ).join('')}</urlset>`;
    expect(extractSitemapLocations(complete)).toHaveLength(SITEMAP_ROUTES.length);
    expect(validateSitemapDocuments([complete])).toEqual([]);

    const missing = complete.replace(
      `<url><loc>${canonicalUrl('/records/forms/tl-x595/')}</loc></url>`,
      '',
    );
    expect(validateSitemapDocuments([missing])).toEqual([
      expect.stringMatching(/records\/forms\/tl-x595/),
    ]);

    const leaked = complete.replace(
      '</urlset>',
      `<url><loc>${canonicalUrl(NOINDEX_ROUTES[0])}</loc></url></urlset>`,
    );
    expect(validateSitemapDocuments([leaked])).toEqual([
      expect.stringMatching(/must exclude controlled canonical URL/),
    ]);
  });

  it('enforces Cloudflare _headers rule and per-line limits', () => {
    expect(validateHeadersLimits('/*\n  X-Test: value\n')).toEqual({
      errors: [],
      longestLineLength: 15,
      ruleCount: 1,
    });
    expect(validateHeadersLimits(`/*\n  X-Test: ${'x'.repeat(2_001)}\n`)).toEqual(
      expect.objectContaining({ errors: [expect.stringMatching(/maximum is 2000/)] }),
    );
    expect(
      validateHeadersLimits(`${Array.from({ length: 101 }, (_, i) => `/rule-${i}`).join('\n')}\n`),
    ).toEqual(expect.objectContaining({ errors: [expect.stringMatching(/maximum is 100/)] }));
  });
});
