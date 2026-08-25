import { expect, test } from '@playwright/test';

import { INDEXABLE_ROUTES, visit } from './support/site';

const CORPORATE_ROUTES = INDEXABLE_ROUTES.filter((route) => route !== '/employee-access/');

const INTERNAL_FORM_ID =
  /\bTL-(?:101|220|340|470|590|P110|P365|O205|N310|N480|SOP-720|SOP-760|SOP-890|X510|X595)\b/i;
const CONTROLLED_SUBJECT_LANGUAGE =
  /restricted phenomena|special access anomalous|nonstandard reality|anomalous emergency|anomalous site expedition|directorate eyes only/i;

test.describe('corporate information boundary', () => {
  for (const route of CORPORATE_ROUTES) {
    test(`${route} does not advertise internal records`, async ({ page }) => {
      await visit(page, route);

      await expect(page.locator('a[href^="/records/"]')).toHaveCount(0);
      const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
      expect(text).not.toMatch(INTERNAL_FORM_ID);
      expect(text).not.toMatch(CONTROLLED_SUBJECT_LANGUAGE);
    });
  }

  test('publications routes public questions and staff access separately', async ({ page }) => {
    await visit(page, '/publications/');
    const main = page.locator('main');

    await expect(
      main.getByRole('heading', { name: 'Publications and institutional resources.' }),
    ).toBeVisible();
    await expect(main.getByRole('link', { name: 'Contact Trinity' })).toHaveAttribute(
      'href',
      '/contact/',
    );
    await expect(main.getByRole('link', { name: 'Employee Access' })).toHaveAttribute(
      'href',
      '/employee-access/',
    );
  });

  test('home uses conventional corporate status language', async ({ page }) => {
    await visit(page, '/');
    const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');

    expect(text).not.toMatch(/condition white|public record|system revision/i);
  });

  test('public routes do not expose implementation vocabulary', async ({ page }) => {
    const forbidden =
      /static publication|repository review|schema validation|deterministic json|approved merge|generated package|withheld plaintext|browser (?:grant|authorization|storage)|local-only|front-end|pagefind|cloudflare|github|astro|photography pending|media reserved/i;

    for (const route of CORPORATE_ROUTES) {
      await visit(page, route);
      const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
      expect(text, `${route} should use only institutional copy`).not.toMatch(forbidden);
    }
  });
});
