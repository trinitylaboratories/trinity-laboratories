import { expect, type Page, type Response } from '@playwright/test';
import {
  CONTROLLED_RECORD_ROUTES,
  FORM_IDS,
  NOINDEX_ROUTES,
  PRODUCTION_ORIGIN,
  REPORT_IDS,
  SITEMAP_ROUTES,
  SITE_ROUTES as CONTRACT_SITE_ROUTES,
} from '../../../scripts/lib/site-contract.mjs';

export { FORM_IDS, PRODUCTION_ORIGIN, REPORT_IDS };
export const INDEXABLE_ROUTES = SITEMAP_ROUTES;
export const RECORD_ROUTES = CONTROLLED_RECORD_ROUTES;
export const CONTROLLED_ROUTES = NOINDEX_ROUTES;
export const SITE_ROUTES = CONTRACT_SITE_ROUTES;

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
