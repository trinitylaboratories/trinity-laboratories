import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_ROUTES,
  CAPABILITY_SLUGS,
  canonicalUrl,
  CONTROLLED_RECORD_ROUTES,
  CORE_ROUTES,
  FORM_IDS,
  FORM_ROUTES,
  NOINDEX_ROUTES,
  PORTAL_ROUTES,
  PRODUCTION_ORIGIN,
  PUBLICATION_IDS,
  PUBLICATION_ROUTES,
  RECORD_INDEX_ROUTES,
  RECORD_ROUTES,
  RESEARCH_RECORD_ROUTES,
  REPORT_IDS,
  REPORT_ROUTES,
  routeToOutputPath,
  SEARCHABLE_FORM_ROUTES,
  SEARCHABLE_RECORD_ROUTES,
  SITEMAP_ROUTES,
  SITE_ROUTES,
  STUDY_FORM_ROUTES,
  STUDY_ROUTES,
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
    expect(RECORD_ROUTES).toHaveLength(19);
    for (const route of FORM_ROUTES) {
      expect(SITE_ROUTES).toContain(route);
      expect(NOINDEX_ROUTES).toContain(route);
      expect(SITEMAP_ROUTES).not.toContain(route);
    }
  });

  it('limits the internal search index to routine forms and the general classification reference', () => {
    expect(SEARCHABLE_FORM_ROUTES).toEqual([
      '/records/forms/tl-101/',
      '/records/forms/tl-220/',
      '/records/forms/tl-p110/',
      '/records/forms/tl-o205/',
      '/records/forms/tl-sop-720/',
    ]);
    expect(SEARCHABLE_RECORD_ROUTES).toEqual([
      '/records/security/information-classification/',
      ...SEARCHABLE_FORM_ROUTES,
    ]);
    expect(SEARCHABLE_RECORD_ROUTES).not.toContain(
      '/records/research/subject-oversight-classification/',
    );
    expect(RESEARCH_RECORD_ROUTES).toEqual(['/records/research/subject-oversight-classification/']);
    for (const route of SEARCHABLE_RECORD_ROUTES) expect(RECORD_ROUTES).toContain(route);
  });

  it('maps trailing-slash routes to static output files', () => {
    expect(routeToOutputPath('/')).toBe('index.html');
    expect(routeToOutputPath('/records/forms/tl-101/')).toBe('records/forms/tl-101/index.html');
  });

  it('keeps every records and staff route outside the public sitemap contract', () => {
    expect(PORTAL_ROUTES).toHaveLength(7);
    expect(PORTAL_ROUTES).toContain('/portal/records/');
    expect(PORTAL_ROUTES).toContain('/portal/research/');
    expect(PORTAL_ROUTES).toContain('/portal/personnel/');
    expect(RECORD_INDEX_ROUTES).toContain('/records/');
    expect(RECORD_INDEX_ROUTES).toContain('/records/security/');
    expect(RECORD_INDEX_ROUTES).toContain('/records/research/');
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
    expect(CORE_ROUTES).toContain('/');
    expect(CORE_ROUTES).toContain('/about/');
    expect(CORE_ROUTES).toContain('/research/');
    expect(CORE_ROUTES).toContain('/studies/');
    expect(CORE_ROUTES).toContain('/facilities/');
    expect(CORE_ROUTES).toContain('/publications/');
    expect(CORE_ROUTES).toContain('/careers/');
    expect(CORE_ROUTES).toContain('/contact/');
    expect(CORE_ROUTES).toContain('/employee-access/');
    expect(CORE_ROUTES).toHaveLength(37);
    expect(SITEMAP_ROUTES).toEqual(CORE_ROUTES);
    expect(SITEMAP_ROUTES.every((route) => !/^\/(?:portal|records)\//.test(route))).toBe(true);
    expect(new Set(SITE_ROUTES).size).toBe(SITE_ROUTES.length);
    expect(SITE_ROUTES).toEqual([...SITEMAP_ROUTES, ...NOINDEX_ROUTES]);
  });

  it('publishes all capability and public technical-note routes', () => {
    expect(CAPABILITY_SLUGS).toHaveLength(8);
    expect(CAPABILITY_ROUTES).toHaveLength(8);
    expect(PUBLICATION_IDS).toHaveLength(14);
    expect(PUBLICATION_ROUTES).toHaveLength(14);
    for (const route of [...CAPABILITY_ROUTES, ...PUBLICATION_ROUTES]) {
      expect(SITEMAP_ROUTES).toContain(route);
      expect(NOINDEX_ROUTES).not.toContain(route);
    }
  });

  it('publishes the complete studies register and keeps study screens local', () => {
    expect(STUDY_ROUTES).toHaveLength(7);
    expect(STUDY_ROUTES[0]).toBe('/studies/');
    expect(STUDY_FORM_ROUTES).toHaveLength(3);
    for (const route of STUDY_ROUTES) expect(SITEMAP_ROUTES).toContain(route);
    for (const route of STUDY_FORM_ROUTES) expect(STUDY_ROUTES).toContain(route);
  });

  it('registers the historical and personnel report corpus exactly once', () => {
    expect(REPORT_IDS).toHaveLength(49);
    expect(new Set(REPORT_IDS).size).toBe(REPORT_IDS.length);
    expect(REPORT_ROUTES).toHaveLength(51);
    for (const recordId of REPORT_IDS) {
      expect(REPORT_ROUTES).toContain(`/records/reports/${recordId}/`);
    }
  });
});
