import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareDeploy, unlinkWithRetry } from '../../scripts/prepare-deploy.mjs';

const temporaryRoots: string[] = [];

async function makeDist() {
  const parent = path.join(process.cwd(), '.tools', 'test-results');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'unit-deploy-'));
  temporaryRoots.push(root);
  await writeFile(
    path.join(root, 'index.html'),
    '<!doctype html><title>Test</title><script>window.localOnly = true;</script>',
    'utf8',
  );
  await writeFile(path.join(root, 'sitemap-index.xml'), '<sitemapindex />', 'utf8');
  await writeFile(path.join(root, 'sitemap-0.xml'), '<urlset />', 'utf8');
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })),
  );
});

describe('prepareDeploy', () => {
  it('writes production policy while retaining generated sitemaps', async () => {
    const root = await makeDist();
    const result = await prepareDeploy({ dist: root, environment: 'production' });
    expect(result.removed).toEqual([]);
    expect(await readFile(path.join(root, 'robots.txt'), 'utf8')).toContain('Allow: /');
    const headers = await readFile(path.join(root, '_headers'), 'utf8');
    expect(headers).toMatch(/script-src 'self' 'wasm-unsafe-eval' 'sha256-[A-Za-z0-9+/]+=+'/);
    expect(headers).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(await readFile(path.join(root, 'sitemap-index.xml'), 'utf8')).toContain('sitemapindex');
  });

  it('writes preview policy and removes all sitemap XML', async () => {
    const root = await makeDist();
    const result = await prepareDeploy({ dist: root, environment: 'preview' });
    expect(result.removed).toHaveLength(2);
    expect(await readFile(path.join(root, 'robots.txt'), 'utf8')).toContain('Disallow: /');
    await expect(readFile(path.join(root, 'sitemap-index.xml'), 'utf8')).rejects.toThrow();
    await expect(readFile(path.join(root, 'sitemap-0.xml'), 'utf8')).rejects.toThrow();
  });

  it('rejects a missing or unsafe output directory', async () => {
    await expect(prepareDeploy({ dist: '.', environment: 'production' })).rejects.toThrow(/unsafe/);
    await expect(
      prepareDeploy({ dist: 'test-results/not-a-build', environment: 'production' }),
    ).rejects.toThrow(/does not exist/);
  });

  it('retries bounded Windows sharing violations when removing preview sitemaps', async () => {
    let attempts = 0;
    await unlinkWithRetry('fixture.xml', {
      retryDelayMs: 0,
      unlinkFile: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw Object.assign(new Error('fixture sharing violation'), { code: 'EBUSY' });
        }
      },
    });
    expect(attempts).toBe(3);
  });
});
