import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { visit } from './support/site';

async function establishBaseSession(page: Page) {
  await page.addInitScript(() => sessionStorage.setItem('tirn-session', 'accepted'));
}

async function seedGenericTrainingGrant(page: Page, level: 'TL-3' | 'TL-4' = 'TL-3') {
  await page.addInitScript((grantLevel) => {
    sessionStorage.setItem('tirn-session', 'accepted');
    sessionStorage.setItem(
      'tirn-grant',
      JSON.stringify({
        version: 1,
        level: grantLevel,
        scope: 'records-review',
        expiresAt: Date.now() + 15 * 60 * 1000,
      }),
    );
  }, level);
}

async function expectNoPersistentPrivateState(
  context: BrowserContext,
  page: Page,
  rawValues: string[],
) {
  const state = await page.evaluate(async () => ({
    grant: sessionStorage.getItem('tirn-grant'),
    sessionStorage: Object.fromEntries(
      Object.keys(sessionStorage).map((key) => [key, sessionStorage.getItem(key)]),
    ),
    localStorage: Object.keys(localStorage),
    indexedDatabases: indexedDB.databases ? await indexedDB.databases() : [],
  }));
  expect(state.localStorage).toEqual([]);
  expect(state.indexedDatabases).toEqual([]);
  for (const rawValue of rawValues) expect(JSON.stringify(state)).not.toContain(rawValue);
  expect(await context.cookies()).toEqual([]);
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

  test('incomplete feedback identifies the missing control without clearing valid fields', async ({
    page,
  }) => {
    await establishBaseSession(page);
    await visit(page, '/portal/authorizations/');

    const gate = page.locator('[data-controlled-section="handling-acknowledgment"]');
    await gate.locator('[data-authorize-trigger]').click();
    const dialog = gate.locator('dialog[open]');
    const form = dialog.locator('[data-authorization-form]');
    const purpose = form.locator('[data-authorization-purpose]');
    const reference = form.locator('[data-authorization-reference]');
    const attestation = form.locator('[data-authorization-attestation]');

    await purpose.selectOption('record-review');
    await reference.fill('TL3-91F7AB');
    await form.getByRole('button', { name: /evaluate request/i }).click();

    await expect(dialog.locator('[data-auth-status]')).toHaveText(
      'Confirm the need-to-know attestation.',
    );
    await expect(purpose).toHaveValue('record-review');
    await expect(reference).toHaveValue('TL3-91F7AB');
    await expect(attestation).not.toBeChecked();
    await expect(attestation).toHaveAttribute('aria-invalid', 'true');
    await expect(attestation).toBeFocused();
    expect(await page.evaluate(() => sessionStorage.getItem('tirn-grant'))).toBeNull();
  });

  test('an invalid authorization reference is retained for correction but never stored', async ({
    context,
    page,
  }) => {
    await establishBaseSession(page);
    const interactionRequests: string[] = [];
    let observeRequests = false;
    page.on('request', (request) => {
      if (observeRequests) interactionRequests.push(`${request.method()} ${request.url()}`);
    });

    await visit(page, '/portal/authorizations/');
    const gate = page.locator('[data-controlled-section="handling-acknowledgment"]');
    await gate.locator('[data-authorize-trigger]').click();
    const dialog = gate.locator('dialog[open]');
    const form = dialog.locator('[data-authorization-form]');
    const rawReference = 'ABC123';
    expect(await form.getAttribute('action')).toBeNull();
    expect(await form.getAttribute('method')).toBeNull();
    await expect(form.locator('input[name], select[name], textarea[name]')).toHaveCount(0);

    await form.locator('[data-authorization-purpose]').selectOption('record-review');
    await form.locator('[data-authorization-reference]').fill(rawReference);
    await form.locator('[data-authorization-attestation]').check();
    observeRequests = true;
    await form.getByRole('button', { name: /evaluate request/i }).click();

    await expect(dialog.locator('[data-auth-status]')).toHaveText(
      'Enter a TL-3 authorization reference in the TL3-XXXXXX format.',
    );
    await expect(form.locator('[data-authorization-reference]')).toHaveValue(rawReference);
    await expect(form.locator('[data-authorization-reference]')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(form.locator('[data-authorization-reference]')).toBeFocused();
    await expect(form.locator('[data-authorization-purpose]')).toHaveValue('record-review');
    await expect(form.locator('[data-authorization-attestation]')).toBeChecked();
    expect(await page.evaluate(() => sessionStorage.getItem('tirn-grant'))).toBeNull();
    await expectNoPersistentPrivateState(context, page, [rawReference]);
    expect(interactionRequests).toEqual([]);
  });

  test('a complete TL-3 request grants access and clears every raw value', async ({
    context,
    page,
  }) => {
    await establishBaseSession(page);
    const interactionRequests: string[] = [];
    let observeRequests = false;
    page.on('request', (request) => {
      if (observeRequests) interactionRequests.push(`${request.method()} ${request.url()}`);
    });

    await visit(page, '/portal/authorizations/');
    const gate = page.locator('[data-controlled-section="handling-acknowledgment"]');
    await gate.locator('[data-authorize-trigger]').click();
    const dialog = gate.locator('[data-authorization-dialog]');
    const form = dialog.locator('[data-authorization-form]');
    const rawReference = 'TL3-91F7AB';

    await form.locator('[data-authorization-purpose]').selectOption('records-administration');
    await form.locator('[data-authorization-reference]').fill(rawReference);
    await form.locator('[data-authorization-attestation]').check();
    observeRequests = true;
    await form.getByRole('button', { name: /evaluate request/i }).click();

    await expect(dialog).not.toBeVisible();
    await expect(gate.locator('[data-controlled-content]')).toBeVisible();
    await expect(gate.locator('[data-controlled-locked]')).toBeHidden();
    await expect(form.locator('[data-authorization-purpose]')).toHaveValue('');
    await expect(form.locator('[data-authorization-reference]')).toHaveValue('');
    await expect(form.locator('[data-authorization-attestation]')).not.toBeChecked();
    const grant = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('tirn-grant') ?? 'null'),
    );
    expect(grant).toEqual({
      version: 1,
      level: 'TL-3',
      scope: 'records-review',
      expiresAt: expect.any(Number),
    });
    expect(grant.expiresAt).toBeGreaterThan(Date.now());
    expect(grant.expiresAt).toBeLessThanOrEqual(Date.now() + 15 * 60 * 1000);
    await expectNoPersistentPrivateState(context, page, [rawReference, 'records-administration']);
    expect(interactionRequests).toEqual([]);
  });

  test('TL-4 requires and clears an independent control-office reference', async ({
    context,
    page,
  }) => {
    await establishBaseSession(page);
    const interactionRequests: string[] = [];
    let observeRequests = false;
    page.on('request', (request) => {
      if (observeRequests) interactionRequests.push(`${request.method()} ${request.url()}`);
    });

    await visit(page, '/portal/authorizations/');
    const gate = page.locator('[data-controlled-section="release-coordination-four"]');
    await gate.locator('[data-authorize-trigger]').click();
    const dialog = gate.locator('[data-authorization-dialog]');
    const form = dialog.locator('[data-authorization-form]');
    const rawReference = 'TL4-91F7AB';
    const rawControlReference = 'CO-91F7AB';

    await expect(form.locator('[data-authorization-reference]')).toHaveAttribute(
      'placeholder',
      'TL4-ABC123',
    );
    await form.locator('[data-authorization-purpose]').selectOption('record-review');
    await form.locator('[data-authorization-reference]').fill(rawReference);
    await form.locator('[data-authorization-attestation]').check();
    await form.getByRole('button', { name: /evaluate request/i }).click();
    await expect(dialog.locator('[data-auth-status]')).toHaveText(
      'Enter a control-office reference in the CO-XXXXXX format.',
    );
    await expect(form.locator('[data-authorization-reference]')).toHaveValue(rawReference);
    await expect(form.locator('[data-control-office-reference]')).toBeFocused();

    await form.locator('[data-control-office-reference]').fill(rawControlReference);
    observeRequests = true;
    await form.getByRole('button', { name: /evaluate request/i }).click();

    await expect(dialog).not.toBeVisible();
    await expect(gate.locator('[data-controlled-content]')).toBeVisible();
    await expect(
      page.locator('[data-controlled-section="handling-acknowledgment"] [data-controlled-content]'),
    ).toBeVisible();
    await expect(form.locator('[data-authorization-reference]')).toHaveValue('');
    await expect(form.locator('[data-control-office-reference]')).toHaveValue('');
    const grant = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('tirn-grant') ?? 'null'),
    );
    expect(grant).toEqual({
      version: 1,
      level: 'TL-4',
      scope: 'records-review',
      expiresAt: expect.any(Number),
    });
    await expectNoPersistentPrivateState(context, page, [rawReference, rawControlReference]);
    expect(interactionRequests).toEqual([]);
  });

  test('TL-5 requires level, control-office, and Directorate references without retaining them', async ({
    context,
    page,
  }) => {
    await establishBaseSession(page);
    const interactionRequests: string[] = [];
    let observeRequests = false;
    page.on('request', (request) => {
      if (observeRequests) interactionRequests.push(`${request.method()} ${request.url()}`);
    });

    await visit(page, '/portal/authorizations/');
    const gate = page.locator('[data-controlled-section="directorate-review-five"]');
    await gate.locator('[data-authorize-trigger]').click();
    const dialog = gate.locator('[data-authorization-dialog]');
    const form = dialog.locator('[data-authorization-form]');
    const rawReference = 'TL5-51A7B9';
    const rawControlReference = 'CO-51A7B9';
    const rawDirectorateReference = 'DR-51A7B9';

    await expect(form.locator('[data-authorization-reference]')).toHaveAttribute(
      'placeholder',
      'TL5-ABC123',
    );
    await expect(form.locator('[data-control-office-reference]')).toHaveCount(1);
    await expect(form.locator('[data-directorate-release-reference]')).toHaveCount(1);
    await expect(form.locator('[data-isolation-reference]')).toHaveCount(0);

    await form.locator('[data-authorization-purpose]').selectOption('record-review');
    await form.locator('[data-authorization-reference]').fill(rawReference);
    await form.locator('[data-authorization-attestation]').check();
    await form.getByRole('button', { name: /evaluate request/i }).click();
    await expect(dialog.locator('[data-auth-status]')).toHaveText(
      'Enter a control-office reference in the CO-XXXXXX format.',
    );
    await expect(form.locator('[data-control-office-reference]')).toBeFocused();

    await form.locator('[data-control-office-reference]').fill(rawControlReference);
    await form.getByRole('button', { name: /evaluate request/i }).click();
    await expect(dialog.locator('[data-auth-status]')).toHaveText(
      'Enter a Directorate release reference in the DR-XXXXXX format.',
    );
    await expect(form.locator('[data-directorate-release-reference]')).toBeFocused();

    await form.locator('[data-directorate-release-reference]').fill(rawDirectorateReference);
    observeRequests = true;
    await form.getByRole('button', { name: /evaluate request/i }).click();

    await expect(dialog).not.toBeVisible();
    await expect(gate.locator('[data-controlled-content]')).toBeVisible();
    await expect(form.locator('[data-authorization-purpose]')).toHaveValue('');
    await expect(form.locator('[data-authorization-reference]')).toHaveValue('');
    await expect(form.locator('[data-control-office-reference]')).toHaveValue('');
    await expect(form.locator('[data-directorate-release-reference]')).toHaveValue('');
    await expect(form.locator('[data-authorization-attestation]')).not.toBeChecked();
    const grant = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('tirn-grant') ?? 'null'),
    );
    expect(grant).toEqual({
      version: 1,
      level: 'TL-5',
      scope: 'records-review',
      expiresAt: expect.any(Number),
    });
    await expectNoPersistentPrivateState(context, page, [
      rawReference,
      rawControlReference,
      rawDirectorateReference,
    ]);
    const documentText = await page.locator('body').textContent();
    for (const rawValue of [rawReference, rawControlReference, rawDirectorateReference]) {
      expect(documentText).not.toContain(rawValue);
    }
    expect(interactionRequests).toEqual([]);
  });

  test('TL-6 also requires isolation-register confirmation and clears every request value', async ({
    context,
    page,
  }) => {
    await establishBaseSession(page);
    const interactionRequests: string[] = [];
    let observeRequests = false;
    page.on('request', (request) => {
      if (observeRequests) interactionRequests.push(`${request.method()} ${request.url()}`);
    });

    await visit(page, '/portal/authorizations/');
    const gate = page.locator('[data-controlled-section="isolated-review-six"]');
    await gate.locator('[data-authorize-trigger]').click();
    const dialog = gate.locator('[data-authorization-dialog]');
    const form = dialog.locator('[data-authorization-form]');
    const rawReference = 'TL6-83C2D4';
    const rawControlReference = 'CO-83C2D4';
    const rawDirectorateReference = 'DR-83C2D4';
    const rawIsolationReference = 'IR-83C2D4';

    await expect(form.locator('[data-authorization-reference]')).toHaveAttribute(
      'placeholder',
      'TL6-ABC123',
    );
    await expect(form.locator('[data-control-office-reference]')).toHaveCount(1);
    await expect(form.locator('[data-directorate-release-reference]')).toHaveCount(1);
    await expect(form.locator('[data-isolation-reference]')).toHaveCount(1);

    await form.locator('[data-authorization-purpose]').selectOption('record-review');
    await form.locator('[data-authorization-reference]').fill('TL5-83C2D4');
    await form.locator('[data-authorization-attestation]').check();
    await form.getByRole('button', { name: /evaluate request/i }).click();
    await expect(dialog.locator('[data-auth-status]')).toHaveText(
      'Enter a TL-6 authorization reference in the TL6-XXXXXX format.',
    );
    await expect(form.locator('[data-authorization-reference]')).toBeFocused();

    await form.locator('[data-authorization-reference]').fill(rawReference);
    await form.getByRole('button', { name: /evaluate request/i }).click();
    await expect(dialog.locator('[data-auth-status]')).toHaveText(
      'Enter a control-office reference in the CO-XXXXXX format.',
    );
    await expect(form.locator('[data-control-office-reference]')).toBeFocused();

    await form.locator('[data-control-office-reference]').fill(rawControlReference);
    await form.getByRole('button', { name: /evaluate request/i }).click();
    await expect(dialog.locator('[data-auth-status]')).toHaveText(
      'Enter a Directorate release reference in the DR-XXXXXX format.',
    );
    await expect(form.locator('[data-directorate-release-reference]')).toBeFocused();

    await form.locator('[data-directorate-release-reference]').fill(rawDirectorateReference);
    await form.getByRole('button', { name: /evaluate request/i }).click();
    await expect(dialog.locator('[data-auth-status]')).toHaveText(
      'Enter an isolation-register reference in the IR-XXXXXX format.',
    );
    await expect(form.locator('[data-isolation-reference]')).toBeFocused();

    await form.locator('[data-isolation-reference]').fill(rawIsolationReference);
    observeRequests = true;
    await form.getByRole('button', { name: /evaluate request/i }).click();

    await expect(dialog).not.toBeVisible();
    await expect(gate.locator('[data-controlled-content]')).toBeVisible();
    await expect(form.locator('[data-authorization-purpose]')).toHaveValue('');
    await expect(form.locator('[data-authorization-reference]')).toHaveValue('');
    await expect(form.locator('[data-control-office-reference]')).toHaveValue('');
    await expect(form.locator('[data-directorate-release-reference]')).toHaveValue('');
    await expect(form.locator('[data-isolation-reference]')).toHaveValue('');
    await expect(form.locator('[data-authorization-attestation]')).not.toBeChecked();
    const grant = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('tirn-grant') ?? 'null'),
    );
    expect(grant).toEqual({
      version: 1,
      level: 'TL-6',
      scope: 'records-review',
      expiresAt: expect.any(Number),
    });
    await expectNoPersistentPrivateState(context, page, [
      rawReference,
      rawControlReference,
      rawDirectorateReference,
      rawIsolationReference,
      'TL5-83C2D4',
    ]);
    const documentText = await page.locator('body').textContent();
    for (const rawValue of [
      rawReference,
      rawControlReference,
      rawDirectorateReference,
      rawIsolationReference,
      'TL5-83C2D4',
    ]) {
      expect(documentText).not.toContain(rawValue);
    }
    expect(interactionRequests).toEqual([]);
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

  test('a TL-3 grant reveals TL-3 records but not TL-4 or withheld bodies', async ({ page }) => {
    await seedGenericTrainingGrant(page);
    await visit(page, '/portal/authorizations/');

    const section = page.locator('[data-controlled-section="handling-acknowledgment"]');
    const record = page.locator('[data-controlled-record="TL-TRN-003"]');
    const tl4 = page.locator('[data-controlled-section="release-coordination-four"]');
    const withheld = page.locator('[data-controlled-section="separate-source-example"]');
    await expect(section.locator('[data-controlled-content]')).toBeVisible();
    await expect(section.locator('[data-controlled-locked]')).toBeHidden();
    await expect(record.locator('[data-controlled-content]')).toBeVisible();
    await expect(record.locator('[data-controlled-locked]')).toBeHidden();
    await expect(tl4.locator('[data-controlled-content]')).toBeHidden();
    await expect(tl4.locator('[data-controlled-locked]')).toBeVisible();
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

  test('an expired TL-4 grant relocks controlled content without navigation', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-08-24T12:00:00Z') });
    await seedGenericTrainingGrant(page, 'TL-4');
    await visit(page, '/portal/authorizations/');
    await expect(
      page.locator(
        '[data-controlled-section="release-coordination-four"] [data-controlled-content]',
      ),
    ).toBeVisible();
    await page.clock.fastForward(15 * 60 * 1000 + 1_000);
    await expect(
      page.locator(
        '[data-controlled-section="release-coordination-four"] [data-controlled-content]',
      ),
    ).toBeHidden();
    await expect(page.locator('[data-portal-current-level]')).toHaveText('TL-2');
    expect(await page.evaluate(() => sessionStorage.getItem('tirn-grant'))).toBeNull();
  });
});
