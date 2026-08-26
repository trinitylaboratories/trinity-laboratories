import { expect, test } from '@playwright/test';

import { visit } from './support/site';

test.describe('research administration portal', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('tirn-session', 'accepted'));
  });

  test('joins the public protocol register, oversight reference, and completed research records', async ({
    page,
  }) => {
    const nonReadRequests: string[] = [];
    page.on('request', (request) => {
      if (!['GET', 'HEAD'].includes(request.method())) {
        nonReadRequests.push(`${request.method()} ${request.url()}`);
      }
    });

    await visit(page, '/portal/research/');

    await expect(
      page.getByRole('heading', { level: 1, name: 'Research administration' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Research', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const studyRows = page.locator('[data-research-study-row]');
    await expect(studyRows).toHaveCount(6);
    await expect(page.getByText('ST-26-014', { exact: true })).toBeVisible();
    await expect(page.locator('[data-research-policy]')).toContainText('TL-RSO-001');
    await expect(page.locator('[data-research-policy-detail]').first()).toBeHidden();
    await expect(page.locator('[data-research-policy-fallback]').first()).toBeVisible();
    const linkedRecordIds = await studyRows.locator('.portal-inline-records a').allTextContents();
    expect(linkedRecordIds).toHaveLength(await studyRows.count());
    expect(new Set(linkedRecordIds).size).toBe(linkedRecordIds.length);
    expect(linkedRecordIds.every((recordId) => /^TL-[A-Z0-9-]+$/.test(recordId))).toBe(true);

    const reportRows = page.locator('[data-research-report-row]');
    const reportCount = await reportRows.count();
    expect(reportCount).toBeGreaterThan(0);
    const reportSummary = page
      .locator('section[aria-labelledby="research-summary-heading"] .portal-summary > div')
      .filter({ hasText: 'Completed reports' });
    await expect(reportSummary.locator('dd')).toHaveText(String(reportCount));
    await expect(page.locator('[data-study-form]')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(
      /applicant inbox|participant submissions/i,
    );
    expect(nonReadRequests).toEqual([]);
  });

  test('keeps elevated report and policy metadata controlled until a qualifying temporary grant exists', async ({
    page,
  }) => {
    await visit(page, '/portal/research/');

    const controlledRow = page.locator('[data-research-report-row]').filter({
      has: page.getByRole('link', { name: 'TL-340-TRN-001', exact: true }),
    });
    await expect(controlledRow).toHaveAttribute('data-required-level', 'TL-3');
    await expect(controlledRow.locator('[data-research-report-title]')).toBeHidden();
    await expect(controlledRow.locator('[data-research-report-title-fallback]')).toBeVisible();
    await expect(controlledRow.getByRole('button', { name: 'Request access' })).toBeVisible();
    const policy = page.locator('[data-research-policy]');
    await expect(policy.locator('[data-research-policy-detail]').first()).toBeHidden();
    await expect(policy.locator('[data-research-policy-fallback]').first()).toBeVisible();

    await page.evaluate(() => {
      sessionStorage.setItem(
        'tirn-grant',
        JSON.stringify({
          version: 1,
          level: 'TL-3',
          scope: 'records-review',
          expiresAt: Date.now() + 10 * 60 * 1000,
        }),
      );
      window.dispatchEvent(new CustomEvent('tirn:access-change'));
    });

    await expect(controlledRow.locator('[data-research-report-title]')).toBeVisible();
    await expect(controlledRow.locator('[data-research-report-title-fallback]')).toBeHidden();
    await expect(policy.locator('[data-research-policy-detail]').first()).toBeVisible();
    await expect(policy.locator('[data-research-policy-fallback]').first()).toBeHidden();
    await expect(policy).toContainText('archived');
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  });

  test('contains wide registers without overflowing a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await visit(page, '/portal/research/');

    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
    await expect(page.locator('.portal-table-wrap').first()).toBeVisible();
  });
});
