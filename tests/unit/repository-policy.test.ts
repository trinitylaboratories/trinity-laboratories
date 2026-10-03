import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findSecrets,
  findLeakedLocalPaths,
  stripJsonComments,
  stripJsonTrailingCommas,
  validateNoActionsFiles,
  validateLocalLauncherSource,
  validatePackageManifest,
  validateWranglerConfig,
} from '../../scripts/validate-repository.mjs';

describe('repository policy', () => {
  it('accepts a repository with no Actions workflows', () => {
    expect(
      validateNoActionsFiles(['.github/ISSUE_TEMPLATE/bug.md', 'scripts/build-site.mjs']),
    ).toEqual([]);
  });

  it('rejects new workflow files, including alternate extensions and Windows paths', () => {
    const files = [
      '.github/workflows/ci.yml',
      '.github/workflows/health.yaml',
      '.github\\workflows\\nested\\test.YML',
    ];
    expect(validateNoActionsFiles(files)).toEqual(
      files.map(
        (file) =>
          `${file}: GitHub Actions workflows are prohibited; use native Cloudflare Workers Builds`,
      ),
    );
  });

  it('rejects Dependabot configs that can bypass Actions disablement', () => {
    for (const file of ['.github/dependabot.yml', '.github/dependabot.yaml']) {
      expect(validateNoActionsFiles([file])).toEqual([
        `${file}: automatic dependency updates use Actions runners; review dependencies locally`,
      ]);
    }
  });

  it('locks the safe Windows clean-path launcher controls', async () => {
    const source = await readFile(path.join(process.cwd(), 'scripts', 'run-local.ps1'), 'utf8');
    expect(validateLocalLauncherSource(source)).toEqual([]);
    expect(validateLocalLauncherSource("Invoke-Expression 'npm run build'", 'unsafe.ps1')).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/safe npm-script token validation/),
        expect.stringMatching(/dynamic evaluation/),
      ]),
    );
  });

  it('parses JSONC comments and trailing commas without changing string contents', () => {
    const jsonc = '{\n  // comment\n  "url": "https://example.test/,}",\n  "items": [1,],\n}\n';
    expect(JSON.parse(stripJsonTrailingCommas(stripJsonComments(jsonc)))).toEqual({
      items: [1],
      url: 'https://example.test/,}',
    });
  });

  it('requires the complete local validation surface in package metadata', () => {
    const requiredScripts = Object.fromEntries(
      [
        'build',
        'cf:build',
        'cf:deploy',
        'check',
        'test:unit',
        'test:e2e',
        'record-desk',
        'record-desk:validate',
        'validate:repo',
        'validate:assets',
        'validate:content',
        'validate:submissions',
        'validate:dist',
        'validate:site',
        'verify:production',
        'prepare:deploy',
      ].map((name) => [name, 'test']),
    );
    requiredScripts.build = 'node scripts/build-site.mjs';
    requiredScripts.check = 'node scripts/run-astro.mjs check';
    requiredScripts.dev = 'node scripts/run-astro.mjs dev';
    requiredScripts.preview = 'node scripts/run-astro.mjs preview';
    requiredScripts.sync = 'node scripts/run-astro.mjs sync';
    requiredScripts['cf:build'] =
      'npm run validate:repo && npm run validate:assets && npm run validate:content && npm run record-desk:validate && npm run validate:submissions && npm run audit && npm run lint && npm run check && npm run test:unit && npm run build && npm run prepare:deploy && npm run validate:dist && npm run validate:site';
    requiredScripts['cf:deploy'] = 'node scripts/deploy-site.mjs';
    requiredScripts['cf:install'] = 'node scripts/install-locked.mjs';
    requiredScripts['verify:production'] =
      'node scripts/verify-indexability.mjs --url https://trinitylaboratories.org --environment production';
    expect(
      validatePackageManifest({
        private: true,
        license: 'MIT',
        packageManager: 'npm@11.17.0',
        engines: { node: '24.19.0', npm: '11.17.0' },
        scripts: requiredScripts,
      }),
    ).toEqual([]);
    requiredScripts['cf:build'] = 'npm run build';
    expect(
      validatePackageManifest({
        private: true,
        license: 'MIT',
        packageManager: 'npm@11.17.0',
        engines: { node: '24.19.0', npm: '11.17.0' },
        scripts: requiredScripts,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/cf:build must run audit/),
        expect.stringMatching(/cf:build must run test:unit/),
        expect.stringMatching(/cf:build must run validate:site/),
      ]),
    );
  });

  it('detects credential-shaped content without embedding a real credential', () => {
    const fakeToken = ['ghp', '_', 'a'.repeat(24)].join('');
    expect(findSecrets(fakeToken, 'fixture.txt')).toEqual([expect.stringMatching(/GitHub token/)]);
  });

  it('rejects absolute local paths while allowing generic Dropbox documentation', () => {
    const slash = '\\';
    const profile = ['C:', slash, 'Users', slash, 'Example', slash, 'file.txt'].join('');
    const dropbox = ['F:', slash, 'Dropbox', slash, 'Project', slash, 'file.txt'].join('');
    const unc = [slash, slash, 'server', slash, 'share', slash, 'Dropbox', slash, 'file.txt'].join(
      '',
    );
    expect(findLeakedLocalPaths([profile, dropbox, unc].join('\n'), 'fixture.txt')).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/user-profile path/),
        expect.stringMatching(/Dropbox path/),
      ]),
    );
    expect(
      findLeakedLocalPaths('Dropbox may be used locally; never publish /_IgnoreThis/.', 'docs.md'),
    ).toEqual([]);
  });

  it('locks Workers static assets to the apex custom domain', () => {
    expect(
      validateWranglerConfig({
        name: 'trinity-laboratories',
        compatibility_date: '2026-08-24',
        workers_dev: false,
        preview_urls: true,
        assets: {
          directory: './dist',
          html_handling: 'auto-trailing-slash',
          not_found_handling: '404-page',
        },
        routes: [{ pattern: 'trinitylaboratories.org', custom_domain: true }],
      }),
    ).toEqual([]);
    expect(
      validateWranglerConfig({
        name: 'wrong-name',
        compatibility_date: '2025-01-01',
        workers_dev: true,
        main: 'src/worker.ts',
        assets: { binding: 'ASSETS', run_worker_first: true },
        routes: [{ pattern: 'www.trinitylaboratories.org', custom_domain: true }],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/name must/),
        expect.stringMatching(/compatibility_date/),
        expect.stringMatching(/workers_dev/),
        expect.stringMatching(/runtime main/),
        expect.stringMatching(/runtime binding/),
        expect.stringMatching(/before asset routing/),
        expect.stringMatching(/apex/),
      ]),
    );
  });
});
