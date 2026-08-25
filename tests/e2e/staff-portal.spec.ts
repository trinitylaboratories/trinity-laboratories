import { expect, test } from '@playwright/test';
import { visit } from './support/site';

const PORTAL_ROUTES = [
  '/portal/',
  '/portal/records/',
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
        'noindex, nofollow, noarchive',
      );
      await expect(page.locator('main[data-pagefind-ignore]')).toHaveCount(1);
      await expect(page.getByRole('navigation', { name: 'Staff services' })).toBeVisible();
      await expect(page.locator('[data-portal-locked]')).toBeVisible();
      await expect(page.locator('[data-portal-staff-content]')).toBeHidden();
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(0);
      await expect(
        page.getByRole('heading', {
          level: 2,
          name: 'Staff Services is limited to authenticated personnel.',
        }),
      ).toBeVisible();
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
      /guest \/ no staff session/i,
    );
    await expect(page.locator('[data-session-warning]')).toBeVisible();
    await expect(page.locator('[data-session-warning]')).toContainText(
      'Unverified session. Internal services remain locked. Return to Employee Access to establish the base TL-2 staff session.',
    );
    await expect(page.locator('[data-revoke-grant]')).toBeHidden();
    await expect(page.getByRole('link', { name: /return to employee access/i })).toBeVisible();
    await expect(page.locator('[data-portal-locked]')).toBeVisible();
    await expect(page.locator('[data-portal-staff-content]')).toBeHidden();
    await expect(page.getByRole('link', { name: /search TIRN/i })).toBeHidden();
  });

  test('forms exposes all approved templates and keeps workstation access terminal-local', async ({
    page,
  }) => {
    await page.addInitScript(() => sessionStorage.setItem('tirn-session', 'accepted'));
    await visit(page, '/portal/forms/');
    const rows = page.locator('[data-form-register-row]');
    await expect(rows).toHaveCount(15);
    await expect(page.getByText('TL-101', { exact: true })).toBeVisible();
    await expect(page.getByText('TL-X595', { exact: true })).toBeVisible();

    const tl1Row = rows.filter({ has: page.getByText('TL-101', { exact: true }) });
    await expect(tl1Row.locator('[data-form-title]')).toHaveText(
      'Routine Research & Technical Activity Record',
    );
    await expect(tl1Row.locator('[data-form-title]')).toBeVisible();
    await expect(tl1Row.locator('[data-form-title-fallback]')).toBeHidden();

    const tl3Row = rows.filter({ has: page.getByText('TL-340', { exact: true }) });
    await expect(tl3Row).toHaveAttribute('data-required-level', 'TL-3');
    await expect(tl3Row.locator('[data-form-title]')).toHaveText(
      'Restricted Phenomena Assessment Record',
    );
    await expect(tl3Row.locator('[data-form-title]')).toBeHidden();
    await expect(tl3Row.locator('[data-form-title-fallback]')).toBeVisible();
    await expect(tl3Row.getByRole('link', { name: 'Review control record' })).toBeVisible();
    await expect(tl3Row.getByRole('button', { name: 'Request access' })).toBeVisible();

    const tl4Row = rows.filter({ has: page.getByText('TL-470', { exact: true }) });
    await expect(tl4Row).toHaveAttribute('data-required-level', 'TL-4');
    await expect(tl4Row.getByRole('link', { name: 'Review control record' })).toBeVisible();
    await expect(tl4Row.getByRole('button', { name: 'Request access' })).toBeVisible();

    const tl5Row = rows.filter({ has: page.getByText('TL-590', { exact: true }) });
    await expect(tl5Row).toHaveAttribute('data-required-level', 'TL-5');
    await expect(tl5Row).toContainText('Separate authorization required');
    await expect(tl5Row.getByRole('button', { name: 'Request access' })).toHaveCount(0);
    await expect(page.locator('[data-filing-workstation-link]')).toHaveCount(0);
    await expect(page.locator('[data-filing-workstation-status]')).toContainText(
      /unavailable from this terminal/i,
    );
  });

  test('forms reveal TL-3 titles only while a qualifying temporary grant is active', async ({
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
          expiresAt: Date.now() + 10 * 60 * 1000,
        }),
      );
    });
    await visit(page, '/portal/forms/');

    const rows = page.locator('[data-form-register-row]');
    const tl3Row = rows.filter({ has: page.getByText('TL-340', { exact: true }) });
    await expect(tl3Row.locator('[data-form-title]')).toBeVisible();
    await expect(tl3Row.locator('[data-form-title-fallback]')).toBeHidden();

    const tl4Row = rows.filter({ has: page.getByText('TL-470', { exact: true }) });
    await expect(tl4Row.locator('[data-form-title]')).toBeHidden();
    await expect(tl4Row.locator('[data-form-title-fallback]')).toBeVisible();

    await visit(page, '/portal/records/');
    const catalogueRows = page.locator('[data-catalogue-row]');
    const tl3CatalogueRow = catalogueRows.filter({
      has: page.getByRole('link', { name: 'TL-P365' }),
    });
    const tl4CatalogueRow = catalogueRows.filter({
      has: page.getByRole('link', { name: 'TL-470' }),
    });
    await expect(tl3CatalogueRow.locator('[data-catalogue-title]')).toBeVisible();
    await expect(tl4CatalogueRow.locator('[data-catalogue-title]')).toBeHidden();
  });

  test('records catalogue filters and sorts canonical metadata without changing browser state', async ({
    page,
  }) => {
    const nonReadRequests: string[] = [];
    page.on('request', (request) => {
      if (!['GET', 'HEAD'].includes(request.method())) {
        nonReadRequests.push(`${request.method()} ${request.url()}`);
      }
    });
    await page.addInitScript(() => sessionStorage.setItem('tirn-session', 'accepted'));
    await visit(page, '/portal/records/');
    const initialUrl = page.url();
    const catalogue = page.locator('[data-record-catalogue]');
    const rows = catalogue.locator('[data-catalogue-row]');
    const total = await rows.count();
    expect(total).toBeGreaterThanOrEqual(19);
    await expect(catalogue.locator('[data-catalogue-visible-count]')).toHaveText(String(total));

    await page.getByLabel('Record, title, office, or tag').fill('TL-340-TRN-001');
    await expect(rows.filter({ visible: true })).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'TL-340-TRN-001' })).toBeVisible();

    await catalogue.locator('[data-catalogue-clear]').click();
    await page.getByLabel('Record type').selectOption('form-template');
    await page.getByLabel('Family').selectOption('personnel');
    await expect(rows.filter({ visible: true })).toHaveCount(2);
    await expect(page.getByRole('link', { name: 'TL-P110' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'TL-P365' })).toBeVisible();
    const routinePersonnelRow = rows.filter({
      has: page.getByRole('link', { name: 'TL-P110' }),
    });
    const controlledPersonnelRow = rows.filter({
      has: page.getByRole('link', { name: 'TL-P365' }),
    });
    await expect(routinePersonnelRow.locator('[data-catalogue-title]')).toBeVisible();
    await expect(controlledPersonnelRow.locator('[data-catalogue-title]')).toBeHidden();
    await expect(controlledPersonnelRow.locator('[data-catalogue-title-fallback]')).toBeVisible();

    await page.getByLabel('Publication').selectOption('controlled');
    await expect(rows.filter({ visible: true })).toHaveCount(2);
    await expect(catalogue.locator('[data-catalogue-empty]')).toBeHidden();

    await catalogue.locator('[data-catalogue-clear]').click();
    await expect(rows.filter({ visible: true })).toHaveCount(total);
    expect(page.url()).toBe(initialUrl);
    expect(
      await page.evaluate(() => ({
        session: sessionStorage.getItem('tirn-session'),
        grant: sessionStorage.getItem('tirn-grant'),
      })),
    ).toEqual({ session: 'accepted', grant: null });
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
    expect(nonReadRequests).toEqual([]);
  });

  test('records catalogue remains a complete static register without JavaScript', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
    const page = await context.newPage();
    try {
      await page.goto('/portal/records/', { waitUntil: 'domcontentloaded' });
      expect(await page.locator('[data-catalogue-row]').count()).toBeGreaterThanOrEqual(19);
      await expect(page.locator('[data-catalogue-controls]')).toHaveAttribute('disabled', '');
      await expect(page.locator('[data-catalogue-query]')).toBeDisabled();
      await expect(page.locator('[data-portal-staff-content]')).toBeHidden();
      await expect(page.locator('[data-catalogue-row]').first()).toBeHidden();
      await expect(page.locator('body')).toHaveAttribute('data-portal-session', 'initializing');
    } finally {
      await context.close();
    }
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
      /guest \/ no staff session/i,
    );
    await expect(page.locator('[data-portal-locked]')).toBeVisible();
    await expect(page.locator('[data-portal-staff-content]')).toBeHidden();
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
    await page.addInitScript(() => sessionStorage.setItem('tirn-session', 'accepted'));
    await visit(page, '/portal/records/');
    await expect(page.getByRole('navigation', { name: 'Staff services' })).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
    await expect(page.locator('.record-catalogue__table-wrap')).toBeVisible();
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
