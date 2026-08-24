import { expect, test } from '@playwright/test';
import { visit } from './support/site';

const PORTAL_ROUTES = [
  '/portal/',
  '/portal/authorizations/',
  '/portal/forms/',
  '/portal/help/',
] as const;

test.describe('staff portal', () => {
  for (const route of PORTAL_ROUTES) {
    test(`${route} is a non-indexed, mundane staff workspace`, async ({ page }) => {
      const nonReadRequests: string[] = [];
      page.on('request', (request) => {
        if (!['GET', 'HEAD'].includes(request.method())) {
          nonReadRequests.push(`${request.method()} ${request.url()}`);
        }
      });

      await visit(page, route);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        'content',
        'noindex, nofollow',
      );
      await expect(page.locator('main[data-pagefind-ignore]')).toHaveCount(1);
      await expect(page.getByRole('navigation', { name: 'Staff services' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      expect(nonReadRequests).toEqual([]);
    });
  }

  test('an accepted gateway session establishes the base TL-2 staff context', async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('tirn-session', 'accepted'));
    await visit(page, '/portal/');

    await expect(page.locator('[data-portal-session-state]')).toHaveText(/Staff \/ TL-2 base/i);
    await expect(page.locator('[data-portal-summary-session]')).toHaveText(
      /staff session accepted/i,
    );
    await expect(page.locator('[data-portal-base-level]')).toHaveText('TL-2');
    await expect(page.locator('[data-portal-current-level]')).toHaveText('TL-2');
    await expect(page.locator('[data-session-warning]')).toBeHidden();
  });

  test('direct portal access remains usable but identifies an unverified session', async ({
    page,
  }) => {
    await visit(page, '/portal/');
    await expect(page.locator('[data-portal-session-state]')).toHaveText(
      /guest \/ released access/i,
    );
    await expect(page.locator('[data-session-warning]')).toBeVisible();
    await expect(page.locator('[data-session-warning]')).toContainText(
      'Unverified session. Released resources remain available. Return to Employee Access to establish the base TL-2 staff session.',
    );
    await expect(page.locator('[data-revoke-grant]')).toBeHidden();
    await expect(page.getByRole('link', { name: /return to employee access/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /search TIRN/i })).toBeVisible();
  });

  test('forms exposes all approved blank templates and the loopback workstation', async ({
    page,
  }) => {
    await visit(page, '/portal/forms/');
    await expect(page.locator('.portal-table tbody tr')).toHaveCount(15);
    await expect(page.getByText('TL-101', { exact: true })).toBeVisible();
    await expect(page.getByText('TL-X595', { exact: true })).toBeVisible();
    await expect(page.locator('[data-filing-workstation-link]')).toHaveAttribute(
      'href',
      'http://127.0.0.1:4319/',
    );
  });

  test('terminating the portal session clears generic session and grant state', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem('tirn-session', 'accepted');
      sessionStorage.setItem(
        'tirn-grant',
        JSON.stringify({
          version: 1,
          level: 'TL-3',
          scope: 'training',
          expiresAt: Date.now() + 60_000,
        }),
      );
    });
    await visit(page, '/portal/');
    await page.locator('[data-terminate-session]').click();

    await expect(page.locator('[data-portal-session-state]')).toHaveText(
      /guest \/ released access/i,
    );
    expect(
      await page.evaluate(() => ({
        session: sessionStorage.getItem('tirn-session'),
        grant: sessionStorage.getItem('tirn-grant'),
      })),
    ).toEqual({ session: null, grant: null });
  });

  test('mobile staff pages contain wide tables without overflowing the viewport', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await visit(page, '/portal/forms/');
    await expect(page.getByRole('navigation', { name: 'Staff services' })).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
    await expect(page.locator('.portal-table-wrap')).toBeVisible();
  });

  test('reduced motion and print preferences remove nonessential portal chrome', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await visit(page, '/portal/');
    const animationDuration = await page
      .locator('.portal-main')
      .evaluate((element) => getComputedStyle(element).animationDuration);
    expect(Number.parseFloat(animationDuration)).toBeLessThanOrEqual(0.001);

    await page.emulateMedia({ media: 'print', reducedMotion: 'reduce' });
    await expect(page.locator('.portal-main')).toBeVisible();
    await expect(page.locator('.portal-nav')).toBeHidden();
    await expect(page.locator('.portal-footer')).toBeHidden();
  });
});
