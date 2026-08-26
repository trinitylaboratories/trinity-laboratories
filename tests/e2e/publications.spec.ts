import { expect, test } from '@playwright/test';

import { visit } from './support/site';

test('public register presents the released library and filters locally', async ({ page }) => {
  await visit(page, '/publications/');

  const register = page.locator('[data-publication-register]');
  const items = register.locator('[data-publication-item]');
  await expect(items).toHaveCount(14);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Small findings, clearly documented.',
  );
  await expect(register).toContainText('Portable Temperature Probe Verification Cycle');
  await expect(register).toContainText('Small-Sensor Display Agreement');

  await page.locator('[data-publication-discipline]').selectOption('Industrial Instrumentation');
  await expect(register.locator('[data-publication-item]:visible')).toHaveCount(4);
  await expect(page.locator('[data-publication-count]')).toHaveText('Showing 4 of 14 public items');

  await page.locator('[data-publication-search]').fill('temperature probe');
  await expect(register.locator('[data-publication-item]:visible')).toHaveCount(1);
  await expect(page.locator('[data-publication-count]')).toHaveText('Showing 1 of 14 public items');

  await page.locator('[data-publication-reset]').click();
  await expect(register.locator('[data-publication-item]:visible')).toHaveCount(14);
});

test('technical-note detail is print-ready and omits internal archive metadata', async ({
  page,
}) => {
  await visit(page, '/publications/tl-101-ins-001/');

  const detail = page.locator('[data-publication-detail]');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Portable Temperature Probe Verification Cycle',
  );
  await expect(detail).toContainText('Three-point comparison');
  await expect(page.getByRole('button', { name: 'Print this note' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Related research' })).toHaveAttribute(
    'href',
    '/research/industrial-instrumentation/',
  );

  const publicText = await page.locator('main').innerText();
  for (const forbidden of [
    'TL-101-INS-001',
    'INS-WO-',
    'TP-014',
    'REF-006',
    'DB-002',
    'Principal Researcher',
    'Physical access',
    'Classification',
  ]) {
    expect(publicText).not.toContain(forbidden);
  }
});

test('completed study summary links back to the public study protocol', async ({ page }) => {
  await visit(page, '/publications/st-24-018/');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Small-Sensor Display Agreement',
  );
  await expect(page.locator('[data-publication-detail]')).toContainText(
    'The method compared displayed agreement and stabilization behavior',
  );
  await expect(
    page.getByRole('link', { name: /View the completed study protocol/ }),
  ).toHaveAttribute('href', '/studies/small-sensor-display-agreement/');
});
