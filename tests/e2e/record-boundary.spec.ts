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
    } else {
      sessionStorage.removeItem('tirn-grant');
    }
  }, grantLevel);
}

function documentBoundary(page: Page, recordId: string) {
  return page.locator(`[data-records-document-boundary][data-record-id="${recordId}"]`);
}

test.describe('direct controlled-form boundary', () => {
  test('a guest sees only generic TL-3 control metadata', async ({ page }) => {
    await visit(page, '/records/forms/tl-340/');

    const boundary = documentBoundary(page, 'TL-340');
    const content = boundary.locator('[data-records-document-content]');
    await expect(boundary).toHaveAttribute('data-access-state', 'locked');
    await expect(boundary.locator('[data-records-document-gate]')).toBeVisible();
    await expect(page.locator('[data-records-toc-boundary]')).toBeHidden();
    await expect(page.locator('[data-protected-record-title-fallback="TL-340"]')).toHaveText(
      'TL-340 — Controlled form template',
    );
    await expect(page.locator('[data-protected-record-title="TL-340"]')).toBeHidden();
    await expect(content).toBeHidden();
    await expect(content.getByText('Phenomenon / Case Designator', { exact: true })).toBeHidden();
    await expect(
      content.locator('a[href="/downloads/forms/tl-340-restricted-phenomena-assessment.docx"]'),
    ).toBeHidden();
    expect(await page.evaluate(() => sessionStorage.getItem('tirn-session'))).toBeNull();
  });

  test('a base staff session opens TL-1 and TL-2 templates but not TL-3', async ({ page }) => {
    await establishAccess(page);

    await visit(page, '/records/forms/tl-101/');
    const tl1 = documentBoundary(page, 'TL-101');
    await expect(tl1).toHaveAttribute('data-access-state', 'authorized');
    await expect(tl1.locator('[data-records-document-content]')).toBeVisible();
    await expect(page.locator('[data-records-toc-boundary]')).toBeVisible();
    await expect(page.locator('[data-protected-record-title="TL-101"]')).toBeVisible();
    await expect(
      tl1.locator('a[href="/downloads/forms/tl-101-routine-research-record.docx"]'),
    ).toBeVisible();

    await visit(page, '/records/forms/tl-220/');
    const tl2 = documentBoundary(page, 'TL-220');
    await expect(tl2).toHaveAttribute('data-access-state', 'authorized');
    await expect(page.locator('[data-protected-record-title="TL-220"]')).toBeVisible();

    await visit(page, '/records/forms/tl-340/');
    const tl3 = documentBoundary(page, 'TL-340');
    await expect(tl3).toHaveAttribute('data-access-state', 'locked');
    await expect(page.locator('[data-records-toc-boundary]')).toBeHidden();
    await expect(tl3.locator('[data-records-document-content]')).toBeHidden();
    await expect(page.locator('[data-protected-record-title="TL-340"]')).toBeHidden();
    await expect(tl3.getByRole('button', { name: 'Request temporary access' })).toBeVisible();
  });

  test('a TL-3 temporary grant reveals TL-3 but not TL-4 material', async ({ page }) => {
    await establishAccess(page, 'TL-3');

    await visit(page, '/records/forms/tl-340/');
    const tl3 = documentBoundary(page, 'TL-340');
    await expect(tl3).toHaveAttribute('data-access-state', 'authorized');
    await expect(page.locator('[data-records-toc-boundary]')).toBeVisible();
    const tl3Title = page.locator('[data-protected-record-title="TL-340"]');
    await expect(tl3Title).toBeVisible();
    await expect(tl3Title).toContainText('Restricted Phenomena Assessment Record');
    await expect(tl3.getByText('Phenomenon / Case Designator', { exact: true })).toBeVisible();
    await expect(
      tl3.locator('a[href="/downloads/forms/tl-340-restricted-phenomena-assessment.docx"]'),
    ).toBeVisible();

    await visit(page, '/records/forms/tl-470/');
    const tl4 = documentBoundary(page, 'TL-470');
    await expect(tl4).toHaveAttribute('data-access-state', 'locked');
    await expect(page.locator('[data-records-toc-boundary]')).toBeHidden();
    await expect(page.locator('[data-protected-record-title="TL-470"]')).toBeHidden();
    await expect(tl4.getByText('Causal Sequence Violation', { exact: true })).toBeHidden();
    await expect(tl4.getByRole('button', { name: 'Request temporary access' })).toBeVisible();
  });

  test('a TL-4 temporary grant satisfies both TL-3 and TL-4 eligibility', async ({ page }) => {
    await establishAccess(page, 'TL-4');

    await visit(page, '/records/forms/tl-340/');
    const tl3 = documentBoundary(page, 'TL-340');
    await expect(tl3).toHaveAttribute('data-access-state', 'authorized');
    await expect(tl3.getByText('Phenomenon / Case Designator', { exact: true })).toBeVisible();

    await visit(page, '/records/forms/tl-470/');
    const tl4 = documentBoundary(page, 'TL-470');
    await expect(tl4).toHaveAttribute('data-access-state', 'authorized');
    const tl4Title = page.locator('[data-protected-record-title="TL-470"]');
    await expect(tl4Title).toBeVisible();
    await expect(tl4Title).toContainText('Special Access Anomalous Research Protocol');
    await expect(tl4.getByText('Causal Sequence Violation', { exact: true })).toBeVisible();
    await expect(
      tl4.locator('a[href="/downloads/forms/tl-470-special-access-anomalous-protocol.docx"]'),
    ).toBeVisible();
  });

  test('TL-5 remains separately controlled even with a TL-4 temporary grant', async ({ page }) => {
    await establishAccess(page, 'TL-4');
    await visit(page, '/records/forms/tl-590/');

    const boundary = documentBoundary(page, 'TL-590');
    const content = boundary.locator('[data-records-document-content]');
    await expect(boundary).toHaveAttribute('data-separately-controlled', 'true');
    await expect(boundary).toHaveAttribute('data-access-state', 'locked');
    await expect(page.locator('[data-records-toc-boundary]')).toBeHidden();
    await expect(boundary.locator('[data-records-document-gate]')).toContainText(
      'Separate authorization is required.',
    );
    await expect(page.locator('[data-protected-record-title-fallback="TL-590"]')).toHaveText(
      'TL-590 — Controlled form template',
    );
    await expect(page.locator('[data-protected-record-title="TL-590"]')).toBeHidden();
    await expect(content).toBeHidden();
    await expect(content.getByText('Knowledge Alters Event', { exact: true })).toBeHidden();
    await expect(
      content.locator('a[href="/downloads/forms/tl-590-directorate-exception-record.docx"]'),
    ).toBeHidden();
    await expect(boundary.locator('[data-authorization-control]')).toHaveCount(0);
  });
});
