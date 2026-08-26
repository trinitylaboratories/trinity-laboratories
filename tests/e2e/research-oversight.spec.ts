import { expect, test, type Page } from '@playwright/test';

import { visit } from './support/site';

type TemporaryLevel = 'TL-3' | 'TL-4';

async function establishAccess(page: Page, grantLevel: TemporaryLevel | null = null) {
  await page.addInitScript((level) => {
    sessionStorage.setItem('tirn-session', 'accepted');
    if (level) {
      sessionStorage.setItem(
        'tirn-grant',
        JSON.stringify({
          version: 1,
          level,
          scope: 'records-review',
          expiresAt: Date.now() + 10 * 60 * 1000,
        }),
      );
    }
  }, grantLevel);
}

const POLICY_ROUTE = '/records/research/subject-oversight-classification/';

function policyBoundary(page: Page) {
  return page.locator('[data-records-document-boundary][data-record-id="TL-RSO-001"]');
}

test.describe('research-subject oversight policy', () => {
  test('a guest sees only generic policy-control metadata', async ({ page }) => {
    await visit(page, POLICY_ROUTE);

    const boundary = policyBoundary(page);
    await expect(boundary).toHaveAttribute('data-access-state', 'locked');
    await expect(boundary.locator('[data-records-document-gate]')).toBeVisible();
    await expect(boundary.locator('[data-records-document-content]')).toBeHidden();
    await expect(page.locator('[data-protected-record-title="TL-RSO-001"]')).toBeHidden();
    await expect(page.locator('[data-protected-record-title-fallback="TL-RSO-001"]')).toHaveText(
      'TL-RSO-001 — Controlled policy',
    );
    await expect(
      boundary
        .locator('[data-records-document-content]')
        .getByText('RS-4', { exact: true })
        .first(),
    ).toBeHidden();
  });

  test('a base staff session does not open the TL-3 policy', async ({ page }) => {
    await establishAccess(page);
    await visit(page, POLICY_ROUTE);

    await expect(policyBoundary(page)).toHaveAttribute('data-access-state', 'locked');
    await expect(page.getByRole('button', { name: 'Request temporary access' })).toBeVisible();
  });

  test('TL-3 opens ordinary oversight material while the elevated appendix remains locked', async ({
    page,
  }) => {
    await establishAccess(page, 'TL-3');
    await visit(page, POLICY_ROUTE);

    const boundary = policyBoundary(page);
    const elevated = page.locator('[data-controlled-section="rso-elevated-appendix"]');
    const directorate = page.locator('[data-controlled-section="rso-directorate-appendix"]');

    await expect(boundary).toHaveAttribute('data-access-state', 'authorized');
    await expect(boundary.locator('[data-records-document-content]')).toBeVisible();
    await expect(page.locator('[data-protected-record-title="TL-RSO-001"]')).toBeVisible();
    await expect(
      boundary
        .locator('[data-records-document-content]')
        .getByText('RS-4', { exact: true })
        .first(),
    ).toBeVisible();
    await expect(elevated.locator('[data-controlled-locked]')).toBeVisible();
    await expect(elevated.locator('[data-controlled-content]')).toBeHidden();
    await expect(elevated.getByText('RS-5', { exact: true })).toBeHidden();
    await expect(directorate.locator('[data-controlled-withheld]')).toBeVisible();
    await expect(directorate.locator('[data-controlled-content]')).toHaveCount(0);
    await expect(boundary.locator('a[href$=".docx"]')).toHaveCount(0);
  });

  test('TL-4 opens elevated RS-5 and RS-6 controls but not Directorate plaintext', async ({
    page,
  }) => {
    await establishAccess(page, 'TL-4');
    await visit(page, POLICY_ROUTE);

    const elevated = page.locator('[data-controlled-section="rso-elevated-appendix"]');
    const directorate = page.locator('[data-controlled-section="rso-directorate-appendix"]');
    await expect(elevated.locator('[data-controlled-content]')).toBeVisible();
    await expect(elevated.getByText('RS-5', { exact: true })).toBeVisible();
    await expect(elevated.getByText('RS-6', { exact: true })).toBeVisible();
    await expect(directorate.locator('[data-controlled-withheld]')).toBeVisible();
    await expect(directorate.locator('[data-controlled-content]')).toHaveCount(0);

    const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    expect(bodyText).not.toMatch(/\bRS-7\b|RS\/Ø|\/ENT\b/i);
  });

  test('the staff catalogue withholds the policy title until TL-3 is active', async ({ page }) => {
    await establishAccess(page);
    await visit(page, '/portal/records/');

    const row = page
      .locator('[data-catalogue-row]')
      .filter({ has: page.getByText('TL-RSO-001', { exact: true }) });
    await expect(row).toHaveCount(1);
    await expect(row.locator('[data-catalogue-title]')).toBeHidden();
    await expect(row.locator('[data-catalogue-title-fallback]')).toBeVisible();

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

    await expect(row.locator('[data-catalogue-title]')).toContainText(
      'Research Subject Oversight Classification System',
    );
    await expect(row.locator('[data-catalogue-title]')).toBeVisible();
    await expect(row.locator('[data-catalogue-title-fallback]')).toBeHidden();
  });
});
