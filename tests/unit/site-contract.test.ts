import { describe, expect, it } from 'vitest';
import {
  canonicalUrl,
  FORM_IDS,
  FORM_ROUTES,
  PRODUCTION_ORIGIN,
  RECORD_ROUTES,
  routeToOutputPath,
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
});
