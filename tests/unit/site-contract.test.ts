import { describe, expect, it } from 'vitest';
import {
  canonicalUrl,
  CONTROLLED_RECORD_ROUTES,
  CORE_ROUTES,
  FORM_IDS,
  FORM_ROUTES,
  NOINDEX_ROUTES,
  PORTAL_ROUTES,
  PRODUCTION_ORIGIN,
  RECORD_INDEX_ROUTES,
  RECORD_ROUTES,
  routeToOutputPath,
  SEARCHABLE_FORM_ROUTES,
  SEARCHABLE_RECORD_ROUTES,
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
    for (const route of FORM_ROUTES) {
      expect(SITE_ROUTES).toContain(route);
      expect(NOINDEX_ROUTES).toContain(route);
      expect(SITEMAP_ROUTES).not.toContain(route);
    }
  });

  it('limits the internal search index to routine forms and security references', () => {
    expect(SEARCHABLE_FORM_ROUTES).toEqual([
      '/records/forms/tl-101/',
      '/records/forms/tl-220/',
      '/records/forms/tl-p110/',
      '/records/forms/tl-o205/',
      '/records/forms/tl-sop-720/',
    ]);
    expect(SEARCHABLE_RECORD_ROUTES).toEqual([
      '/records/security/information-classification/',
      '/records/security/physical-access/',
      '/records/security/endorsements-and-conditions/',
      ...SEARCHABLE_FORM_ROUTES,
    ]);
    for (const route of SEARCHABLE_RECORD_ROUTES) expect(RECORD_ROUTES).toContain(route);
  });

  it('maps trailing-slash routes to static output files', () => {
    expect(routeToOutputPath('/')).toBe('index.html');
    expect(routeToOutputPath('/records/forms/tl-101/')).toBe('records/forms/tl-101/index.html');
  });

  it('keeps every records and staff route outside the public sitemap contract', () => {
    expect(PORTAL_ROUTES).toHaveLength(5);
    expect(PORTAL_ROUTES).toContain('/portal/records/');
    expect(RECORD_INDEX_ROUTES).toContain('/records/');
    expect(RECORD_INDEX_ROUTES).toContain('/records/security/');
    for (const route of CONTROLLED_RECORD_ROUTES) {
      expect(route).toMatch(/^\/records\//);
      expect(NOINDEX_ROUTES).toContain(route);
    }
    for (const route of NOINDEX_ROUTES) {
      expect(SITE_ROUTES).toContain(route);
      expect(SITEMAP_ROUTES).not.toContain(route);
    }
  });

  it('publishes only corporate routes and partitions every required route exactly once', () => {
    expect(CORE_ROUTES).toEqual([
      '/',
      '/about/',
      '/research/',
      '/facilities/',
      '/publications/',
      '/careers/',
      '/contact/',
      '/employee-access/',
    ]);
    expect(SITEMAP_ROUTES).toEqual(CORE_ROUTES);
    expect(SITEMAP_ROUTES.every((route) => !/^\/(?:portal|records)\//.test(route))).toBe(true);
    expect(new Set(SITE_ROUTES).size).toBe(SITE_ROUTES.length);
    expect(SITE_ROUTES).toEqual([...SITEMAP_ROUTES, ...NOINDEX_ROUTES]);
  });
});
