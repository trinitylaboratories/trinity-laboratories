import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { visit } from './support/site';

async function establishBaseSession(page: import('@playwright/test').Page) {
  await page.addInitScript(() => sessionStorage.setItem('tirn-session', 'accepted'));
}

async function seedGenericTrainingGrant(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem('tirn-session', 'accepted');
    sessionStorage.setItem(
      'tirn-grant',
      JSON.stringify({
        version: 1,
        level: 'TL-3',
        scope: 'training',
        expiresAt: Date.now() + 15 * 60 * 1000,
      }),
    );
  });
}

test.describe('browser-local authorization controls', () => {
  test('authorization input is unavailable when JavaScript is disabled', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
    const page = await context.newPage();
    try {
      await page.goto('/portal/authorizations/', { waitUntil: 'domcontentloaded' });
      const form = page.locator('[data-authorization-form]').first();
      await expect(form.locator('fieldset')).toHaveAttribute('disabled', '');
      await expect(form.locator('input, select, button').first()).toBeDisabled();
      await expect(page.locator('[data-authorize-trigger]').first()).toBeDisabled();
      await expect(page.locator('[data-controlled-content]').first()).toBeHidden();
    } finally {
      await context.close();
    }
  });

  test('an invalid credential is cleared and retained nowhere', async ({ context, page }) => {
    await establishBaseSession(page);
    const nonReadRequests: string[] = [];
    page.on('request', (request) => {
      if (!['GET', 'HEAD'].includes(request.method())) {
        nonReadRequests.push(`${request.method()} ${request.url()}`);
      }
    });

    await visit(page, '/portal/authorizations/');
    const gate = page.locator('[data-controlled-section="handling-acknowledgment"]');
    await gate.locator('[data-authorize-trigger]').click();
    const dialog = page.locator('dialog[open]');
    const form = dialog.locator('[data-authorization-form]');
    expect(await form.getAttribute('action')).toBeNull();
    expect(await form.getAttribute('method')).toBeNull();
    await expect(form.locator('input[name], select[name], textarea[name]')).toHaveCount(0);

    await form.locator('[data-authorization-purpose]').selectOption('record-review');
    await form.locator('[data-authorization-credential]').fill('INVALID-CREDENTIAL-VALUE');
    await form.locator('[data-authorization-attestation]').check();
    await form.getByRole('button', { name: /evaluate authorization/i }).click();

    await expect(dialog.locator('[data-auth-status]')).toContainText(/not recognized/i);
    await expect(form.locator('[data-authorization-credential]')).toHaveValue('');
    await expect(form.locator('[data-authorization-purpose]')).toHaveValue('');
    await expect(form.locator('[data-authorization-attestation]')).not.toBeChecked();
    expect(await page.evaluate(() => sessionStorage.getItem('tirn-grant'))).toBeNull();
    expect(await page.locator('body').innerText()).not.toContain('INVALID-CREDENTIAL-VALUE');
    expect(await context.cookies()).toEqual([]);
    expect(nonReadRequests).toEqual([]);
    expect(
      await page.evaluate(async () => ({
        localStorage: Object.keys(localStorage),
        indexedDatabases: indexedDB.databases ? await indexedDB.databases() : [],
      })),
    ).toEqual({ localStorage: [], indexedDatabases: [] });
  });

  test('a completed form with the employee terminal code reports an unrecognized credential', async ({
    page,
  }) => {
    await establishBaseSession(page);
    await visit(page, '/portal/authorizations/');

    const gate = page.locator('[data-controlled-section="handling-acknowledgment"]');
    await gate.locator('[data-authorize-trigger]').click();
    const dialog = gate.locator('dialog[open]');
    const form = dialog.locator('[data-authorization-form]');

    await form.locator('[data-authorization-purpose]').selectOption('record-review');
    await form.locator('[data-authorization-credential]').fill('ABC123');
    await form.locator('[data-authorization-attestation]').check();
    await form.getByRole('button', { name: /evaluate authorization/i }).click();

    await expect(dialog.locator('[data-auth-status]')).toContainText(/not recognized/i);
    await expect(form.locator('[data-authorization-credential]')).toHaveValue('');
    await expect(form.locator('[data-authorization-purpose]')).toHaveValue('');
    await expect(form.locator('[data-authorization-attestation]')).not.toBeChecked();
    expect(await page.evaluate(() => sessionStorage.getItem('tirn-grant'))).toBeNull();
  });

  test('the open authorization console has no serious accessibility violations', async ({
    page,
  }) => {
    await establishBaseSession(page);
    await visit(page, '/portal/authorizations/');
    await page.locator('[data-authorize-trigger]').first().click();
    await expect(page.locator('dialog[open]')).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical'),
    ).toEqual([]);
  });

  test('keyboard users can enter and leave the authorization console with focus restored', async ({
    page,
  }) => {
    await establishBaseSession(page);
    await visit(page, '/portal/authorizations/');
    const trigger = page.locator('[data-authorize-trigger]').first();
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('dialog[open]')).toBeVisible();
    await expect(page.locator('dialog[open] [data-authorization-purpose]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('a generic active grant reveals TL-3 sections and records but never a withheld body', async ({
    page,
  }) => {
    await seedGenericTrainingGrant(page);
    await visit(page, '/portal/authorizations/');

    const section = page.locator('[data-controlled-section="handling-acknowledgment"]');
    const record = page.locator('[data-controlled-record="TL-TRN-003"]');
    const withheld = page.locator('[data-controlled-section="separate-source-example"]');
    await expect(section.locator('[data-controlled-content]')).toBeVisible();
    await expect(section.locator('[data-controlled-locked]')).toBeHidden();
    await expect(record.locator('[data-controlled-content]')).toBeVisible();
    await expect(record.locator('[data-controlled-locked]')).toBeHidden();
    await expect(withheld.locator('[data-controlled-withheld]')).toBeVisible();
    await expect(withheld.locator('[data-controlled-content]')).toHaveCount(0);
    await expect(page.locator('[data-portal-current-level]')).toHaveText('TL-3');
  });

  test('relinquishing the grant immediately relocks section and whole-record content', async ({
    page,
  }) => {
    await seedGenericTrainingGrant(page);
    await visit(page, '/portal/authorizations/');
    await expect(page.locator('[data-controlled-content]').first()).toBeVisible();
    await page.locator('[data-revoke-grant]').click();

    await expect(
      page.locator('[data-controlled-section="handling-acknowledgment"] [data-controlled-content]'),
    ).toBeHidden();
    await expect(
      page.locator('[data-controlled-record="TL-TRN-003"] [data-controlled-content]'),
    ).toBeHidden();
    expect(await page.evaluate(() => sessionStorage.getItem('tirn-grant'))).toBeNull();
  });

  test('an expired grant relocks controlled content without navigation', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-08-24T12:00:00Z') });
    await seedGenericTrainingGrant(page);
    await visit(page, '/portal/authorizations/');
    await expect(page.locator('[data-controlled-content]').first()).toBeVisible();
    await page.clock.fastForward(15 * 60 * 1000 + 1_000);
    await expect(page.locator('[data-controlled-content]').first()).toBeHidden();
    await expect(page.locator('[data-portal-current-level]')).toHaveText('TL-2');
  });
});
