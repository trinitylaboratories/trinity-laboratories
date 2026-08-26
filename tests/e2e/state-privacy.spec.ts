import { expect, test, type Page } from '@playwright/test';
import { visit } from './support/site';

type PrivacyCalls = { beacons: string[]; fetches: string[] };

async function installPrivacyProbe(page: Page) {
  await page.addInitScript(() => {
    const calls: PrivacyCalls = { beacons: [], fetches: [] };
    Object.defineProperty(window, '__trinityPrivacyCalls', { value: calls });

    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      calls.fetches.push(
        typeof input === 'string' ? input : 'url' in input ? input.url : input.href,
      );
      return originalFetch(input, init);
    }) as typeof window.fetch;

    const originalBeacon = navigator.sendBeacon?.bind(navigator);
    if (originalBeacon) {
      navigator.sendBeacon = ((url: string | URL, data?: BodyInit | null) => {
        calls.beacons.push(String(url));
        return originalBeacon(url, data);
      }) as typeof navigator.sendBeacon;
    }
  });
}

async function browserState(page: Page) {
  return page.evaluate(async () => {
    const local: Record<string, string | null> = {};
    const session: Record<string, string | null> = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)!;
      local[key] = localStorage.getItem(key);
    }
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index)!;
      session[key] = sessionStorage.getItem(key);
    }
    const databases = 'databases' in indexedDB ? await indexedDB.databases() : [];
    const calls = (window as typeof window & { __trinityPrivacyCalls: PrivacyCalls })
      .__trinityPrivacyCalls;
    return {
      calls,
      databases: databases.map(({ name }) => name ?? '(unnamed)'),
      local,
      session,
    };
  });
}

for (const route of ['/contact/', '/careers/']) {
  test(`${route} discards raw values without storage, URL, fetch, beacon, cookie, or POST leakage`, async ({
    context,
    page,
  }) => {
    await installPrivacyProbe(page);
    const nonReadRequests: string[] = [];
    page.on('request', (request) => {
      if (!['GET', 'HEAD'].includes(request.method())) {
        nonReadRequests.push(`${request.method()} ${request.url()}`);
      }
    });
    await visit(page, route);
    const rawMarker = `RAW-${route.includes('contact') ? 'CONTACT' : 'CAREER'}-7f91`;
    const form = page.locator('[data-local-form]');
    await form.locator('input[type="text"]').evaluateAll((inputs, marker) => {
      for (const input of inputs) {
        (input as HTMLInputElement).value = marker;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, rawMarker);
    await form.locator('input[type="email"]').fill(`${rawMarker.toLowerCase()}@example.test`);
    await form.locator('select').selectOption({ index: 1 });
    await form.locator('textarea').fill(`${rawMarker} ${'local test statement '.repeat(3)}`);
    await form.getByRole('button', { name: /submit|send/i }).click();

    await expect(form.locator('[data-form-status]')).toContainText(/thank you/i);
    for (const control of await form.locator('input, textarea').all())
      await expect(control).toHaveValue('');
    await expect(form.locator('select')).toHaveValue('');
    expect(decodeURIComponent(page.url())).not.toContain(rawMarker);
    expect(JSON.stringify(await browserState(page))).not.toContain(rawMarker);
    expect(await context.cookies()).toEqual([]);
    expect(nonReadRequests).toEqual([]);
    expect(await browserState(page)).toEqual({
      calls: { beacons: [], fetches: [] },
      databases: [],
      local: {},
      session: {},
    });
  });
}

for (const route of [
  '/studies/indoor-condition-observation/',
  '/studies/household-timekeeping-stability/',
  '/studies/consumer-compass-repeatability/',
]) {
  test(`${route} screening creates no request or durable browser state`, async ({
    context,
    page,
  }) => {
    await installPrivacyProbe(page);
    const nonReadRequests: string[] = [];
    page.on('request', (request) => {
      if (!['GET', 'HEAD'].includes(request.method())) {
        nonReadRequests.push(`${request.method()} ${request.url()}`);
      }
    });

    await visit(page, route);
    const initialUrl = page.url();
    const form = page.locator('[data-study-form]');
    for (const checkbox of await form.locator('input[type="checkbox"]').all()) {
      await checkbox.check();
    }
    for (const select of await form.locator('select').all()) {
      await select.selectOption({ index: 1 });
    }
    for (const number of await form.locator('input[type="number"]').all()) {
      await number.fill((await number.getAttribute('min')) ?? '1');
    }
    await form.getByRole('button', { name: 'Complete participation screen' }).click();

    await expect(form.locator('[data-study-status]')).toContainText(/eligibility provisional/i);
    expect(page.url()).toBe(initialUrl);
    expect(await context.cookies()).toEqual([]);
    expect(nonReadRequests).toEqual([]);
    expect(await browserState(page)).toEqual({
      calls: { beacons: [], fetches: [] },
      databases: [],
      local: {},
      session: {},
    });
  });
}

test('gateway retains only an opaque session flag and clears it on termination', async ({
  context,
  page,
}) => {
  await installPrivacyProbe(page);
  const nonReadRequests: string[] = [];
  page.on('request', (request) => {
    if (!['GET', 'HEAD'].includes(request.method())) nonReadRequests.push(request.url());
  });
  await visit(page, '/employee-access/');
  const rawBadge = 'RAW-BADGE-91F7';
  await page.locator('[data-generate-code]').click();
  const rawCode = (await page.locator('[data-terminal-code]').textContent())?.trim() ?? '';
  await page.locator('#badge-id').fill(rawBadge);
  await page.locator('#terminal-code').fill(rawCode);
  await Promise.all([
    page.waitForURL((url) => url.pathname === '/portal/'),
    page.getByRole('button', { name: /sign in/i }).click(),
  ]);

  const acceptedState = await browserState(page);
  expect(acceptedState.local).toEqual({});
  expect(acceptedState.session).toEqual({ 'tirn-session': 'accepted' });
  expect(JSON.stringify(acceptedState)).not.toContain(rawBadge);
  expect(JSON.stringify(acceptedState)).not.toContain(rawCode);
  expect(decodeURIComponent(page.url())).not.toContain(rawBadge);
  expect(decodeURIComponent(page.url())).not.toContain(rawCode);
  expect(await context.cookies()).toEqual([]);
  expect(nonReadRequests).toEqual([]);

  await page.locator('[data-session-terminate]').click();
  expect(await browserState(page)).toEqual({
    calls: { beacons: [], fetches: [] },
    databases: [],
    local: {},
    session: {},
  });
});
