import { expect, test, type Locator, type Page } from '@playwright/test';
import { visit } from './support/site';

const STUDY_ROUTES = [
  '/studies/indoor-condition-observation/',
  '/studies/household-timekeeping-stability/',
  '/studies/consumer-compass-repeatability/',
] as const;

async function completeScreen(form: Locator) {
  for (const checkbox of await form.locator('input[type="checkbox"]').all()) {
    await checkbox.check();
  }
  for (const select of await form.locator('select').all()) {
    await select.selectOption({ index: 1 });
  }
  for (const number of await form.locator('input[type="number"]').all()) {
    const minimum = (await number.getAttribute('min')) ?? '1';
    await number.fill(minimum);
  }
}

test('study register presents six bounded protocols and their current status', async ({ page }) => {
  await visit(page, '/studies/');
  const register = page.locator('[data-study-register]');
  await expect(register.locator('li')).toHaveCount(6);
  await expect(register).toContainText('ST-26-014');
  await expect(register).toContainText('Participation open');
  await expect(register).toContainText('Protocol complete');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Observe ordinary systems carefully.',
  );
});

for (const route of STUDY_ROUTES) {
  test(`${route} participation screen validates, resets, and issues only an opaque reference`, async ({
    page,
  }) => {
    await visit(page, route);
    const form = page.locator('form[data-study-form]');
    const status = form.locator('[data-study-status]');

    await expect(form).toHaveCount(1);
    await expect(form.locator('fieldset')).toBeEnabled();
    expect(await form.getAttribute('action')).toBeNull();
    expect(await form.getAttribute('method')).toBeNull();
    await expect(form.locator('[name]')).toHaveCount(0);

    await form.getByRole('button', { name: 'Complete participation screen' }).click();
    await expect(status).toContainText(/screen incomplete/i);

    await completeScreen(form);
    await form.getByRole('button', { name: 'Complete participation screen' }).click();
    await expect(status).toHaveText(
      /^PRE-SCREEN COMPLETE — ELIGIBILITY PROVISIONAL\. NO ENROLLMENT RECORD CREATED\. SCREENING REFERENCE: [A-HJ-NP-Z2-9]{6}\.$/,
    );
    await expect(form.locator('input[type="checkbox"]:checked')).toHaveCount(0);
    for (const select of await form.locator('select').all()) {
      await expect(select).toHaveValue('');
    }
    for (const number of await form.locator('input[type="number"]').all()) {
      await expect(number).toHaveValue('');
    }
  });
}

test('participation submission is unavailable without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page: Page = await context.newPage();
  await visit(page, STUDY_ROUTES[0]);
  const form = page.locator('form[data-study-form]');
  await expect(form.locator('fieldset')).toHaveAttribute('disabled', '');
  await expect(form.getByRole('button', { name: 'Complete participation screen' })).toBeDisabled();
  await expect(form.locator('[data-study-status]')).toHaveText(
    'Participation screen initialization required.',
  );
  await context.close();
});
