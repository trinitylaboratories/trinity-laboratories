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
  '/facilities/',
  '/publications/',
  '/careers/',
  '/contact/',
  '/employee-access/',
] as const;

export const RECORD_ROUTES = [
  '/records/',
  '/records/search/',
  '/records/security/',
  '/records/security/information-classification/',
  '/records/security/physical-access/',
  '/records/security/endorsements-and-conditions/',
  '/records/forms/',
  ...FORM_IDS.map((id) => `/records/forms/${id}/`),
  '/records/reports/',
  '/records/reports/tl-101-ins-001/',
  '/records/reports/tl-220-ea-001/',
  '/records/reports/tl-340-trn-001/',
  '/records/reports/tl-sop-720-fs-001/',
  '/records/submissions/',
] as const;

export const CONTROLLED_ROUTES = [
  '/portal/',
  '/portal/records/',
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
