import { describe, expect, it } from 'vitest';
import {
  canonicalUrl,
  FORM_IDS,
  FORM_ROUTES,
  NOINDEX_ROUTES,
  PORTAL_ROUTES,
  PRODUCTION_ORIGIN,
  RECORD_ROUTES,
  routeToOutputPath,
  SITEMAP_ROUTES,
  SITE_ROUTES,
} from '../../scripts/lib/site-contract.mjs';

describe('site contract', () => {
  it('locks canonical URLs to the apex domain', () => {
    expect(PRODUCTION_ORIGIN).toBe('https://trinitylaboratories.org');
    expect(canonicalUrl('/records/')).toBe('https://trinitylaboratories.org/records/');
    expect(canonicalUrl('/about')).toBe('https://trinitylaboratories.org/about/');
  });

  it('includes each required form exactly once', () => {
    expect(FORM_IDS).toHaveLength(15);
    expect(new Set(FORM_IDS).size).toBe(15);
    expect(FORM_ROUTES).toHaveLength(15);
    expect(RECORD_ROUTES).toHaveLength(18);
    for (const route of FORM_ROUTES) expect(SITE_ROUTES).toContain(route);
  });

  it('maps trailing-slash routes to static output files', () => {
    expect(routeToOutputPath('/')).toBe('index.html');
    expect(routeToOutputPath('/records/forms/tl-101/')).toBe('records/forms/tl-101/index.html');
  });

  it('keeps staff and controlled-record routes outside the public sitemap contract', () => {
    expect(PORTAL_ROUTES).toHaveLength(5);
    expect(PORTAL_ROUTES).toContain('/portal/records/');
    for (const route of [
      '/records/reports/tl-101-ins-001/',
      '/records/reports/tl-220-ea-001/',
      '/records/reports/tl-340-trn-001/',
      '/records/reports/tl-sop-720-fs-001/',
    ]) {
      expect(NOINDEX_ROUTES).toContain(route);
    }
    for (const route of NOINDEX_ROUTES) {
      expect(SITE_ROUTES).toContain(route);
      expect(SITEMAP_ROUTES).not.toContain(route);
    }
  });
});
