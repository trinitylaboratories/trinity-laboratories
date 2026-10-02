import { expect, test } from '@playwright/test';
import { visit } from './support/site';

const publicRoutes = ['/', '/about/', '/research/', '/facilities/', '/careers/', '/contact/'];
const viewports = [
  { width: 360, height: 800 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

for (const viewport of viewports) {
  test(`public pages fit at ${viewport.width}px without overlapping hero copy`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const route of publicRoutes) {
      await visit(page, route);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        `${route} should not overflow at ${viewport.width}px`,
      ).toBeLessThanOrEqual(1);
      const title = page.locator('h1');
      const box = await title.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
      if (route !== '/') {
        const introBox = await page.locator('.page-hero__intro').boundingBox();
        expect(introBox).not.toBeNull();
        const separate =
          introBox!.x >= box!.x + box!.width - 1 || introBox!.y >= box!.y + box!.height - 1;
        expect(separate, `${route} title and intro must not overlap`).toBe(true);
      }
      const credit = page.locator('.builder-credit');
      await expect(credit).toContainText('Built with ❤️ by');
      const link = credit.getByRole('link', { name: /JPowersFreelancing/ });
      await expect(link).toHaveAttribute('href', 'https://jpowersfreelancing.com/');
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      for (const image of await page.locator('main img').all()) {
        await image.scrollIntoViewIfNeeded();
        await expect
          .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
          .toBeGreaterThan(0);
      }
      const images = await page.locator('main img').evaluateAll((elements) =>
        elements.map((element) => {
          const image = element as HTMLImageElement;
          return {
            src: image.getAttribute('src'),
            loaded: image.complete && image.naturalWidth > 0,
          };
        }),
      );
      expect(
        images.filter(({ loaded }) => !loaded),
        `${route} images must load`,
      ).toEqual([]);
    }
  });
}

test('homepage keeps eight research paths and a restrained pair of hero links', async ({
  page,
}) => {
  await visit(page, '/');
  await expect(page.locator('.home-hero .button')).toHaveCount(2);
  await expect(page.locator('.capability-list a')).toHaveCount(8);
  await expect(page.locator('.capability-list a p')).toHaveCount(8);
});
