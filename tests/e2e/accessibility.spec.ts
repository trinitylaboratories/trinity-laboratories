import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { SITE_ROUTES, visit } from './support/site';

test.describe('WCAG accessibility gate', () => {
  for (const route of SITE_ROUTES) {
    test(`${route} has no serious or critical automated violations`, async ({ page }) => {
      await visit(page, route);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const blocking = results.violations.filter(
        ({ impact }) => impact === 'serious' || impact === 'critical',
      );

      expect(
        blocking,
        blocking
          .map(
            ({ id, help, nodes }) =>
              `${id}: ${help}\n${nodes.map((node) => `  ${node.target.join(' ')}: ${node.failureSummary}`).join('\n')}`,
          )
          .join('\n\n'),
      ).toEqual([]);
    });
  }
});
