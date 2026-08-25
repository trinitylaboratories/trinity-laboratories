import { expect, test, type Page } from '@playwright/test';
import { visit } from './support/site';

const FICTIONAL_NAMES = [
  'Mara Venn',
  'Adrian Pell',
  'Elise Rowan',
  'Calvin Orrett',
  'Noa Ferris',
  'Irene Vale',
] as const;

async function installGrant(page: Page, level: 'TL-3' | 'TL-4') {
  await page.addInitScript((grantLevel) => {
    sessionStorage.setItem('tirn-session', 'accepted');
    sessionStorage.setItem(
      'tirn-grant',
      JSON.stringify({
        version: 1,
        level: grantLevel,
        scope: 'records-review',
        expiresAt: Date.now() + 10 * 60 * 1000,
      }),
    );
  }, level);
}

test('personnel register exposes six generic control files without subject identities', async ({
  page,
}) => {
  await page.addInitScript(() => sessionStorage.setItem('tirn-session', 'accepted'));
  await visit(page, '/portal/personnel/');

  await expect(page.locator('[data-personnel-register-row]')).toHaveCount(6);
  await expect(page.getByText('Personnel Assignment Record — File 2402')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request access' })).toHaveCount(6);
  const visibleText = await page.locator('body').innerText();
  for (const name of FICTIONAL_NAMES) expect(visibleText).not.toContain(name);
});

test('TL-3 personnel identity appears only with a matching temporary grant', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('tirn-session', 'accepted'));
  await visit(page, '/records/reports/tl-p110-per-9302/');
  await expect(page).toHaveTitle(/TL-P110-PER-9302 — Controlled report/);
  await expect(page.getByRole('heading', { name: 'Controlled report', exact: true })).toBeVisible();
  await expect(page.getByText('Mara Venn')).toBeHidden();

  await installGrant(page, 'TL-3');
  await visit(page, '/records/reports/tl-p110-per-9302/');
  await expect(page.getByText('Mara Venn')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Personnel Assignment Record — File 9302', exact: true }),
  ).toBeVisible();
});

test('a TL-3 grant does not reveal a TL-4 personnel file', async ({ page }) => {
  await installGrant(page, 'TL-3');
  await visit(page, '/records/reports/tl-p110-per-2402/');
  await expect(page.getByText('Irene Vale')).toBeHidden();
  await expect(page.locator('[data-controlled-record="TL-P110-PER-2402"]')).toHaveAttribute(
    'data-access-state',
    'locked',
  );

  await page.evaluate(() => {
    sessionStorage.setItem(
      'tirn-grant',
      JSON.stringify({
        version: 1,
        level: 'TL-4',
        scope: 'records-review',
        expiresAt: Date.now() + 10 * 60 * 1000,
      }),
    );
    window.dispatchEvent(new CustomEvent('tirn:access-change'));
  });
  await expect(page.getByText('Irene Vale')).toBeVisible();
});
