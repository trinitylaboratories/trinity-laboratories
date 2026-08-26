import { expect, test } from '@playwright/test';
import { captureRuntimeErrors, SITE_ROUTES, visit } from './support/site';

test.describe('required routes', () => {
  for (const route of SITE_ROUTES) {
    test(`${route} renders its primary document without runtime errors`, async ({ page }) => {
      const runtimeErrors = captureRuntimeErrors(page);
      await visit(page, route);

      await expect(page).toHaveTitle(/\S/);
      await expect(page.locator('html')).toHaveAttribute('lang', /\S/);
      await expect(page.locator('main')).toHaveCount(1);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h1')).not.toBeEmpty();
      await expect(page.locator('body')).toBeVisible();
      expect(runtimeErrors).toEqual([]);
    });
  }
});

test('unknown routes return the designed 404 response', async ({ page }) => {
  const response = await page.goto('/this-route-must-not-exist/', {
    waitUntil: 'domcontentloaded',
  });
  expect(response?.status()).toBe(404);
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('h1')).toHaveCount(1);
});

test('home uses curated facility media in its hero and exposes the careers path', async ({
  page,
}) => {
  await visit(page, '/');
  await expect(page.locator('[data-hero-media] img')).toHaveAttribute(
    'src',
    '/media/facilities/instrumented-testing.webp',
  );
  await expect(page.getByRole('link', { name: 'View careers' })).toHaveAttribute(
    'href',
    '/careers/',
  );
});

test('official 1986 lockups replace the provisional site mark', async ({ page }) => {
  await visit(page, '/');
  await expect(page.locator('.site-header [data-brand-asset="full"] img')).toHaveAttribute(
    'src',
    '/media/brand/trinity-full.png',
  );
  await expect(page.locator('.site-footer [data-brand-asset="full"] img')).toHaveAttribute(
    'src',
    '/media/brand/trinity-full.png',
  );
  await expect(page.locator('.brand-mark__symbol')).toHaveCount(0);

  await visit(page, '/portal/');
  await expect(page.locator('.portal-header [data-brand-asset="wordmark"] img')).toHaveAttribute(
    'src',
    '/media/brand/trinity-wordmark.png',
  );
});

test('records session termination remains available at every supported viewport', async ({
  page,
}) => {
  await visit(page, '/records/');
  await page.evaluate(() => sessionStorage.setItem('tirn-session', 'accepted'));
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('[data-session-state]')).toHaveText(/session accepted/i);
  const terminate = page.locator('[data-session-terminate]');
  await expect(terminate).toBeVisible();
  await terminate.click();
  await expect(page.locator('[data-session-state]')).toHaveText(/guest \/ no staff session/i);
  expect(await page.evaluate(() => sessionStorage.getItem('tirn-session'))).toBeNull();
});
