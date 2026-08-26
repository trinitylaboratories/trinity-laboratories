import { expect, type Page, type Response } from '@playwright/test';

export const PRODUCTION_ORIGIN = 'https://trinitylaboratories.org';

export const FORM_IDS = [
  'tl-101',
  'tl-220',
  'tl-340',
  'tl-470',
  'tl-590',
  'tl-p110',
  'tl-p365',
  'tl-o205',
  'tl-n310',
  'tl-n480',
  'tl-sop-720',
  'tl-sop-760',
  'tl-sop-890',
  'tl-x510',
  'tl-x595',
] as const;

export const INDEXABLE_ROUTES = [
  '/',
  '/about/',
  '/research/',
  '/studies/',
  '/studies/indoor-condition-observation/',
  '/studies/household-timekeeping-stability/',
  '/studies/consumer-compass-repeatability/',
  '/studies/paper-substrate-curl-recovery/',
  '/studies/diagram-recall-route-notation/',
  '/studies/small-sensor-display-agreement/',
  '/facilities/',
  '/publications/',
  '/careers/',
  '/contact/',
  '/employee-access/',
] as const;

export const REPORT_IDS = [
  'tl-101-am-8701',
  'tl-101-cr-8801',
  'tl-101-ii-8902',
  'tl-220-ea-9101',
  'tl-101-ap-9303',
  'tl-220-pe-9502',
  'tl-220-am-9704',
  'tl-101-fs-9901',
  'tl-101-pe-0002',
  'tl-101-ea-0102',
  'tl-220-ap-0301',
  'tl-101-ii-0503',
  'tl-220-ls-0702',
  'tl-101-ea-0904',
  'tl-220-ii-1102',
  'tl-101-am-1305',
  'tl-220-cr-1402',
  'tl-220-pe-1503',
  'tl-220-fs-1701',
  'tl-101-ls-1904',
  'tl-220-ii-2102',
  'tl-101-ls-2201',
  'tl-220-am-2303',
  'tl-220-fs-2501',
  'tl-101-ins-001',
  'tl-220-ea-001',
  'tl-340-trn-001',
  'tl-sop-720-fs-001',
  'tl-p110-per-9302',
  'tl-p110-per-9804',
  'tl-p110-per-0403',
  'tl-p110-per-1110',
  'tl-p110-per-1806',
  'tl-p110-per-2402',
] as const;

export const RECORD_ROUTES = [
  '/records/',
  '/records/search/',
  '/records/security/',
  '/records/security/information-classification/',
  '/records/security/physical-access/',
  '/records/security/endorsements-and-conditions/',
  '/records/research/',
  '/records/research/subject-oversight-classification/',
  '/records/forms/',
  ...FORM_IDS.map((id) => `/records/forms/${id}/`),
  '/records/reports/',
  ...REPORT_IDS.map((id) => `/records/reports/${id}/`),
  '/records/submissions/',
] as const;

export const CONTROLLED_ROUTES = [
  '/portal/',
  '/portal/records/',
  '/portal/personnel/',
  '/portal/authorizations/',
  '/portal/forms/',
  '/portal/help/',
  ...RECORD_ROUTES,
] as const;

export const SITE_ROUTES = [...INDEXABLE_ROUTES, ...CONTROLLED_ROUTES] as const;

export function canonicalUrl(route: string): string {
  return new URL(route, PRODUCTION_ORIGIN).href;
}

export async function visit(page: Page, route: string): Promise<Response> {
  const response = await page.goto(route, { waitUntil: 'networkidle' });
  expect(response, `${route} should return a document response`).not.toBeNull();
  expect(response!.status(), `${route} should return HTTP 200`).toBe(200);
  return response!;
}

export function captureRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}
