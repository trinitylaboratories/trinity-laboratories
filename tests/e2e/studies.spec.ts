import { expect, test, type Locator, type Page } from '@playwright/test';
import { STUDY_FORM_ROUTES } from '../../scripts/lib/site-contract.mjs';
import { visit } from './support/site';

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

test('study register presents six studies and their current status', async ({ page }) => {
  await visit(page, '/studies/');
  const register = page.locator('[data-study-register]');
  await expect(register.locator('li')).toHaveCount(6);
  await expect(register).toContainText('ST-26-014');
  await expect(register).toContainText('Participation open');
  await expect(register).toContainText('Protocol complete');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Everyday questions, studied carefully.',
  );
});

for (const route of STUDY_FORM_ROUTES) {
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

    await form.getByRole('button', { name: 'Check my eligibility' }).click();
    await expect(status).toHaveText('Please complete the highlighted fields.');

    await completeScreen(form);
    await form.getByRole('button', { name: 'Check my eligibility' }).click();
    await expect(status).toHaveText(
      /^Eligibility provisional\. You meet the preliminary criteria\. Your reference for this session is [A-HJ-NP-Z2-9]{6}\. This check does not enroll you in the study\.$/,
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
  await visit(page, STUDY_FORM_ROUTES[0]);
  const form = page.locator('form[data-study-form]');
  await expect(form.locator('fieldset')).toHaveAttribute('disabled', '');
  await expect(form.getByRole('button', { name: 'Check my eligibility' })).toBeDisabled();
  await expect(form.locator('[data-study-status]')).toHaveText('Preparing the eligibility form…');
  await context.close();
});
