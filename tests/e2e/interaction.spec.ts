import { expect, test } from '@playwright/test';
import { visit } from './support/site';

test('keyboard users receive a visible focus indicator and working skip link', async ({ page }) => {
  await visit(page, '/');
  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: /skip to content/i });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  const focusStyle = await skipLink.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(focusStyle.outlineStyle).not.toBe('none');
  expect(Number.parseFloat(focusStyle.outlineWidth)).toBeGreaterThanOrEqual(2);

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main-content$/);
  await expect(page.locator('#main-content')).toBeVisible();
});

test('desktop home hero layers readable copy over full-bleed facility media', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page, '/');

  const heroBox = await page.locator('.home-hero').boundingBox();
  const mediaBox = await page.locator('[data-hero-media]').boundingBox();
  const title = page.locator('.home-hero h1');
  const titleBox = await title.boundingBox();
  expect(heroBox).not.toBeNull();
  expect(mediaBox).not.toBeNull();
  expect(titleBox).not.toBeNull();
  expect(Math.abs(mediaBox!.x - heroBox!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(mediaBox!.y - heroBox!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(mediaBox!.width - heroBox!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(mediaBox!.height - heroBox!.height)).toBeLessThanOrEqual(1);
  expect(titleBox!.x).toBeGreaterThanOrEqual(heroBox!.x);
  expect(titleBox!.y).toBeGreaterThanOrEqual(heroBox!.y);
  await expect(title).toHaveCSS('color', 'rgb(255, 255, 255)');
});

test('mobile page hero keeps its institutional index clear of the title', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page, '/publications/');

  const indexBox = await page.locator('.page-hero__index').boundingBox();
  const titleBox = await page.locator('.page-hero h1').boundingBox();
  expect(indexBox).not.toBeNull();
  expect(titleBox).not.toBeNull();
  expect(indexBox!.y + indexBox!.height).toBeLessThanOrEqual(titleBox!.y);
});

test('gateway controls complete their core path using only the keyboard', async ({ page }) => {
  await visit(page, '/employee-access/');
  const badge = page.locator('#badge-id');
  const generate = page.locator('[data-generate-code]');
  const terminalCode = page.locator('#terminal-code');

  await badge.focus();
  await page.keyboard.type('TL-KEYBOARD-1');
  await generate.focus();
  await expect(generate).toBeFocused();
  await page.keyboard.press('Enter');
  const code = (await page.locator('[data-terminal-code]').textContent())?.trim() ?? '';
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  await expect(terminalCode).toBeFocused();
  await page.keyboard.type(code);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => url.pathname === '/portal/');
});

test('reduced-motion preference removes reveal transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await visit(page, '/');
  const revealItems = page.locator('[data-reveal]');
  expect(await revealItems.count()).toBeGreaterThan(0);
  for (const item of await revealItems.all()) {
    const style = await item.evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        opacity: computed.opacity,
        transform: computed.transform,
        transitionDuration: computed.transitionDuration,
      };
    });
    expect(style.opacity).toBe('1');
    expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(style.transform);
    expect(Number.parseFloat(style.transitionDuration)).toBeLessThanOrEqual(0.001);
  }

  await page.addInitScript(() => sessionStorage.setItem('tirn-session', 'accepted'));
  await visit(page, '/records/');
  const recordsPane = page.locator('.main-pane');
  const recordsStyle = await recordsPane.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      animationDuration: computed.animationDuration,
      opacity: computed.opacity,
      transform: computed.transform,
    };
  });
  expect(recordsStyle.animationDuration).toBe('0s');
  expect(recordsStyle.opacity).toBe('1');
  expect(recordsStyle.transform).toBe('none');
});

test('mobile navigation and page content remain available without JavaScript', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await page.goto('/about/', { waitUntil: 'domcontentloaded' });
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Careers' })).toBeVisible();
    const reveal = page.locator('[data-reveal]').first();
    await expect(reveal).toBeVisible();
    expect(await reveal.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');

    await nav.getByRole('link', { name: 'Careers' }).click();
    await expect(page).toHaveURL(/\/careers\/$/);
    const localFieldset = page.locator('[data-local-form] fieldset');
    await expect(localFieldset).toHaveAttribute('disabled', '');
    await expect(localFieldset.locator('input, select, textarea, button').first()).toBeDisabled();

    await page.goto('/employee-access/', { waitUntil: 'domcontentloaded' });
    const gatewayFieldset = page.locator('[data-gateway-form] fieldset');
    await expect(gatewayFieldset).toHaveAttribute('disabled', '');
    await expect(gatewayFieldset.locator('input, button').first()).toBeDisabled();
  } finally {
    await context.close();
  }
});

test('corporate pages expose clean print output', async ({ page }) => {
  await visit(page, '/contact/');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('.site-header')).toBeHidden();
  await expect(page.locator('.site-footer')).toBeHidden();
  await expect(page.locator('[data-local-form]')).toBeHidden();
  expect(await page.locator('body').evaluate((element) => getComputedStyle(element).color)).toBe(
    'rgb(0, 0, 0)',
  );
});

test('records pages hide application chrome when printed', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('tirn-session', 'accepted'));
  await visit(page, '/records/');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('header.header')).toBeHidden();
  const sidebar = page.locator('.sidebar-pane');
  if (await sidebar.count()) await expect(sidebar).toBeHidden();
});

test('terminal codes expire after five minutes in the actual client implementation', async ({
  page,
}) => {
  await visit(page, '/employee-access/');
  await page.clock.install({ time: new Date('2026-08-24T12:00:00Z') });
  await page.locator('[data-generate-code]').click();
  await expect(page.locator('[data-terminal-code]')).not.toHaveText('------');
  await page.clock.fastForward(5 * 60 * 1000 + 1_000);
  await expect(page.locator('[data-terminal-code]')).toHaveText('------');
  await expect(page.locator('[data-gateway-status]')).toContainText(/expired/i);
});
