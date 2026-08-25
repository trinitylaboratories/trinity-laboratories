import { expect, test, type Page } from '@playwright/test';

import { captureRuntimeErrors, visit } from './support/site';

const REPORT_ROUTE = '/records/reports/tl-340-trn-001/';
const STRUCTURED_REPORT_ROUTE = '/records/reports/tl-101-ins-001/';

async function establishStaffSession(page: Page) {
  await page.addInitScript(() => sessionStorage.setItem('tirn-session', 'accepted'));
}

test('completed-report catalogs expose only safe control metadata', async ({ page }) => {
  await establishStaffSession(page);
  await visit(page, '/records/reports/');
  const reportLink = page.getByRole('link', { name: 'TL-340-TRN-001' });
  const reportRow = page.getByRole('row').filter({ has: reportLink });
  await expect(reportLink).toHaveAttribute('href', REPORT_ROUTE);
  await expect(reportRow.getByText('Access-Control Training Assessment')).toBeVisible();
  await expect(reportRow.getByRole('cell', { name: 'TL-3', exact: true })).toBeVisible();
  await expect(reportRow.getByRole('cell', { name: 'controlled', exact: true })).toBeVisible();

  await visit(page, '/records/submissions/');
  await expect(page.getByRole('heading', { name: 'Published submissions' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'TL-340-TRN-001' })).toHaveAttribute(
    'href',
    REPORT_ROUTE,
  );
});

test('workstation field paragraphs render as semantic labeled rows', async ({ page }) => {
  await establishStaffSession(page);
  await visit(page, STRUCTURED_REPORT_ROUTE);

  const projectTitle = page
    .locator('[data-submission-field-row]')
    .filter({ has: page.locator('dt', { hasText: 'Project / Study Title' }) });
  await expect(projectTitle.locator('dt')).toHaveText('Project / Study Title');
  await expect(projectTitle.locator('dd')).toHaveText(
    'Portable Temperature Probe Verification Cycle',
  );

  const resultSummary = page
    .locator('[data-submission-field-row]')
    .filter({ has: page.locator('dt', { hasText: 'Result Summary' }) });
  await expect(resultSummary.locator('dt')).toHaveText('Result Summary');
  await expect(resultSummary.locator('dd')).toContainText(
    'Both units met the ±0.5 °C acceptance tolerance.',
  );
  await expect(page.locator('[data-submission-field-list]')).not.toHaveCount(0);
  await expect(page.locator('[data-submission-field-row] strong')).toHaveCount(0);
  expect(await projectTitle.innerHTML()).not.toContain('**');
});

test('TL-3 report is redacted without an elevated session', async ({ page }) => {
  const runtimeErrors = captureRuntimeErrors(page);
  await establishStaffSession(page);
  await visit(page, REPORT_ROUTE);

  await expect(page.locator('[data-record-id="TL-340-TRN-001"]')).toBeVisible();
  await expect(page.locator('[data-pagefind-meta="record-id"]')).toHaveText('TL-340-TRN-001');
  await expect(
    page.getByText('Physical authority').locator('..').getByText('Not specified'),
  ).toBeVisible();

  const controlledRecord = page.locator('[data-controlled-record="TL-340-TRN-001"]');
  const recordLock = controlledRecord.locator(':scope > [data-controlled-locked]');
  await expect(controlledRecord).toHaveAttribute('data-mode', 'authorize');
  await expect(controlledRecord).toHaveAttribute('data-access-state', 'locked');
  await expect(recordLock).toBeVisible();
  await expect(recordLock.locator('[data-authorize-trigger]')).toBeEnabled();
  await expect(
    page.getByText('This record describes a records-handling exercise only.'),
  ).toBeHidden();
  await expect(
    page.getByText('The exercise is complete when the operator distinguishes information'),
  ).toBeHidden();
  expect(runtimeErrors).toEqual([]);
});

test('a generic browser-local TL-3 grant reveals authorized training content only', async ({
  page,
}) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('tirn-session', 'accepted');
    sessionStorage.setItem(
      'tirn-grant',
      JSON.stringify({
        version: 1,
        level: 'TL-3',
        scope: 'training',
        expiresAt: Date.now() + 10 * 60 * 1000,
      }),
    );
  });
  await visit(page, REPORT_ROUTE);

  const controlledRecord = page.locator('[data-controlled-record="TL-340-TRN-001"]');
  await expect(controlledRecord).toHaveAttribute('data-access-state', 'authorized');
  await expect(controlledRecord.locator(':scope > [data-controlled-locked]')).toBeHidden();

  const openSection = page.locator('[data-controlled-section="exercise-scope"]');
  await expect(openSection).toHaveAttribute('data-mode', 'open');
  await expect(
    openSection.getByText('This record describes a records-handling exercise only.'),
  ).toBeVisible();
  await expect(openSection.locator('[data-submission-section-body] > p')).toHaveCount(1);
  await expect(openSection.locator('[data-submission-field-list]')).toHaveCount(0);

  const authorizedSection = page.locator('[data-controlled-section="evaluation-criteria"]');
  await expect(authorizedSection).toHaveAttribute('data-mode', 'authorize');
  await expect(authorizedSection).toHaveAttribute('data-access-state', 'authorized');
  const authorizedBody = authorizedSection.getByText(
    'The exercise is complete when the operator distinguishes information',
  );
  await expect(authorizedBody).toBeVisible();
  expect(
    await authorizedBody.evaluate((node) => Boolean(node.closest('[data-pagefind-ignore]'))),
  ).toBe(true);

  const withheldSection = page.locator('[data-controlled-section="review-annotation"]');
  await expect(withheldSection).toHaveAttribute('data-mode', 'withheld');
  await expect(withheldSection.locator('[data-controlled-withheld]')).toBeVisible();
  await expect(withheldSection).toContainText('Content withheld from this publication');
  await expect(withheldSection.locator('[data-controlled-content]')).toHaveCount(0);
});

test('Pagefind indexes released report fields but excludes controlled body text', async ({
  page,
}) => {
  await establishStaffSession(page);
  await visit(page, '/records/search/');
  const search = page.getByRole('search').getByRole('textbox', { name: 'Search released records' });

  await search.fill('TL-340-TRN-001');
  const reportResult = page.locator(`a[href*="${REPORT_ROUTE}"]`).first();
  await expect(reportResult).toBeVisible({ timeout: 15_000 });

  await search.fill('operator distinguishes information');
  await expect(page.locator('.pagefind-ui__message')).toContainText(
    'operator distinguishes information',
    { timeout: 15_000 },
  );
  await expect(page.locator(`a[href*="${REPORT_ROUTE}"]`)).toHaveCount(0, { timeout: 15_000 });

  await search.fill('TP-014 maximum absolute deviation');
  await expect(page.locator(`a[href*="${STRUCTURED_REPORT_ROUTE}"]`).first()).toBeVisible({
    timeout: 15_000,
  });

  await search.fill('maximum mean error was 1.1 percent');
  await expect(page.locator('.pagefind-ui__message')).toContainText(
    'maximum mean error was 1.1 percent',
    { timeout: 15_000 },
  );
  await expect(page.locator('a[href*="/records/reports/tl-220-ea-001/"]')).toHaveCount(0, {
    timeout: 15_000,
  });
});

test('completed-report interactions make no non-read or external request', async ({ page }) => {
  const disallowedRequests: string[] = [];
  let observedOrigin = '';
  page.on('request', (request) => {
    if (!observedOrigin) return;
    const requestUrl = new URL(request.url());
    if (!['GET', 'HEAD'].includes(request.method()) || requestUrl.origin !== observedOrigin) {
      disallowedRequests.push(`${request.method()} ${request.url()}`);
    }
  });

  await establishStaffSession(page);
  await visit(page, REPORT_ROUTE);
  observedOrigin = new URL(page.url()).origin;
  const recordLock = page.locator(
    '[data-controlled-record="TL-340-TRN-001"] > [data-controlled-locked]',
  );
  await recordLock.locator('[data-authorize-trigger]').click();
  const authorizationDialog = recordLock.locator('[data-authorization-dialog]');
  await expect(authorizationDialog).toBeVisible();
  await authorizationDialog.getByRole('button', { name: 'Close authorization console' }).click();

  expect(disallowedRequests).toEqual([]);
});
