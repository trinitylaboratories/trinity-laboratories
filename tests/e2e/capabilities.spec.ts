import { expect, test } from '@playwright/test';

import { CAPABILITIES } from '../../src/lib/capabilities';
import { captureRuntimeErrors, visit } from './support/site';

test('research index links every approved public capability', async ({ page }) => {
  await visit(page, '/research/');

  const capabilityIndex = page.locator('.capability-index');
  for (const capability of CAPABILITIES) {
    await expect(
      capabilityIndex
        .locator('li')
        .filter({ hasText: capability.title })
        .getByRole('link', { name: 'View capability', exact: true }),
    ).toHaveAttribute('href', `/research/${capability.slug}/`);
  }
});

for (const capability of CAPABILITIES) {
  test(`${capability.title} provides methods, boundaries, and released evidence`, async ({
    page,
  }) => {
    const runtimeErrors = captureRuntimeErrors(page);
    await visit(page, `/research/${capability.slug}/`);

    await expect(page.getByRole('heading', { level: 1, name: capability.title })).toBeVisible();
    await expect(page.locator('.capability-questions li')).toHaveCount(3);
    await expect(page.locator('.capability-method__columns > div')).toHaveCount(2);
    await expect(page.locator('.capability-output > div')).toHaveCount(2);
    await expect(page.locator('.capability-notes li')).not.toHaveCount(0);
    await expect(page.locator('.capability-notes a').first()).toHaveAttribute(
      'href',
      /^\/publications\/[a-z0-9-]+\/$/,
    );
    await expect(page.locator('main')).not.toContainText(/accredited|certified laboratory/i);

    expect(runtimeErrors).toEqual([]);
  });
}
