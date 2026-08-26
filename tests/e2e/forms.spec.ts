import { expect, test } from '@playwright/test';
import { visit } from './support/site';

for (const route of ['/contact/', '/careers/']) {
  test(`${route} form remains entirely local`, async ({ page }) => {
    const requests: string[] = [];
    let observeRequests = false;
    page.on('request', (request) => {
      if (!observeRequests) return;
      const requestUrl = new URL(request.url());
      const pageOrigin = new URL(page.url()).origin;
      if (request.method() !== 'GET' || requestUrl.origin !== pageOrigin) {
        requests.push(`${request.method()} ${request.url()}`);
      }
    });

    await visit(page, route);
    const form = page.locator('form[data-local-form]');
    await expect(form).toHaveCount(1);
    await expect(form.locator('fieldset')).toBeEnabled();
    expect(await form.getAttribute('action')).toBeNull();
    expect(await form.getAttribute('method')).toBeNull();
    await expect(form.locator('input[name], select[name], textarea[name]')).toHaveCount(0);

    await form.locator('input[type="text"]').evaluateAll((inputs) => {
      for (const input of inputs) {
        (input as HTMLInputElement).value = 'Trinity Test Operator';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    const email = form.locator('input[type="email"]');
    if (await email.count()) await email.fill('operator@example.test');
    await form.locator('select').selectOption({ index: 1 });
    await form
      .locator('textarea')
      .fill('This local-only test message is intentionally long enough to satisfy validation.');

    observeRequests = true;
    const wasPrevented = await form.evaluate(
      (element) =>
        new Promise<boolean>((resolve) => {
          element.addEventListener(
            'submit',
            (event) => queueMicrotask(() => resolve(event.defaultPrevented)),
            { capture: true, once: true },
          );
          (element as HTMLFormElement).requestSubmit();
        }),
    );

    expect(wasPrevented).toBe(true);
    await expect(form.locator('[data-form-status]')).toContainText(/thank you/i);
    await page.waitForTimeout(100);
    expect(requests).toEqual([]);
    expect(new URL(page.url()).pathname).toBe(route);
  });
}
