import { expect, test } from '@playwright/test';
import { visit } from './support/site';

test('employee gateway issues and verifies a browser-local terminal code', async ({ page }) => {
  const nonReadRequests: string[] = [];
  page.on('request', (request) => {
    if (!['GET', 'HEAD'].includes(request.method())) {
      nonReadRequests.push(`${request.method()} ${request.url()}`);
    }
  });

  await visit(page, '/employee-access/');
  const form = page.locator('form[data-gateway-form]');
  await expect(form).toHaveCount(1);
  await expect(form.locator('fieldset')).toBeEnabled();
  await expect(form.locator('input[name], select[name], textarea[name]')).toHaveCount(0);
  expect(await form.getAttribute('action')).toBeNull();

  const generate = form.locator('[data-generate-code]');
  const output = form.locator('[data-terminal-code]');
  await expect(generate).toBeVisible();
  await expect(output).toHaveText('------');
  await generate.click();
  const code = (await output.textContent())?.trim() ?? '';
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

  await form.locator('#badge-id').fill('TL-TEST-01');
  await form.locator('#terminal-code').fill(code);
  await Promise.all([
    page.waitForURL((url) => url.pathname === '/portal/'),
    form.getByRole('button', { name: /establish session/i }).click(),
  ]);

  await expect(page.locator('[data-session-state]')).toHaveText(/staff \/ tl-2 base/i);
  expect(await page.evaluate(() => sessionStorage.getItem('tirn-session'))).toBe('accepted');
  await page.locator('[data-session-terminate]').click();
  await expect(page.locator('[data-session-state]')).toHaveText(/guest \/ no staff session/i);
  expect(await page.evaluate(() => sessionStorage.getItem('tirn-session'))).toBeNull();
  expect(nonReadRequests).toEqual([]);
});
