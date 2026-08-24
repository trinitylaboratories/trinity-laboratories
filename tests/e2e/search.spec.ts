import { expect, test } from '@playwright/test';
import { captureRuntimeErrors, visit } from './support/site';

test('records search returns and opens a representative indexed form', async ({ page }) => {
  const runtimeErrors = captureRuntimeErrors(page);
  const remoteRequests: string[] = [];
  let observeRequests = false;
  page.on('request', (request) => {
    if (!observeRequests) return;
    const requestUrl = new URL(request.url());
    if (/^https?:$/.test(requestUrl.protocol) && requestUrl.origin !== new URL(page.url()).origin) {
      remoteRequests.push(request.url());
    }
  });

  const response = await visit(page, '/records/search/');
  const contentSecurityPolicy = response.headers()['content-security-policy'] ?? '';
  expect(contentSecurityPolicy).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(contentSecurityPolicy.split(/\s+/)).not.toContain("'unsafe-eval'");
  observeRequests = true;
  const search = page.getByRole('search').getByRole('textbox', { name: 'Search released records' });
  await expect(search).toBeVisible();
  await search.fill('TL-101');

  const result = page
    .locator('a[href*="/records/forms/tl-101/"]')
    .filter({ hasText: /TL-101/i })
    .first();
  await expect(result).toBeVisible({ timeout: 15_000 });
  await result.click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/records/forms/tl-101/');
  await expect(page.locator('h1')).toContainText(/TL-101/i);
  expect(remoteRequests).toEqual([]);
  expect(runtimeErrors).toEqual([]);
});
