import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findSecrets,
  findLeakedLocalPaths,
  stripJsonComments,
  stripJsonTrailingCommas,
  validateCiSource,
  validateLocalLauncherSource,
  validatePackageManifest,
  validateWranglerConfig,
  validateWorkflowSource,
} from '../../scripts/validate-repository.mjs';

const pinnedSha = '0123456789abcdef0123456789abcdef01234567';

describe('repository policy', () => {
  it('accepts pinned read-only workflows with bounded jobs', () => {
    const workflow = `name: CI
on: push
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@${pinnedSha}
        with:
          persist-credentials: false
`;
    expect(validateWorkflowSource(workflow, 'ci.yml')).toEqual([]);
  });

  it('locks the complete CI policy surface', async () => {
    const source = await readFile(
      path.join(process.cwd(), '.github', 'workflows', 'ci.yml'),
      'utf8',
    );
    expect(validateCiSource(source)).toEqual([]);
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

  it('rejects mutable actions and privilege-escalating triggers', () => {
    const workflow = `on:
  pull_request_target:
permissions: write-all
jobs:
  unsafe:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
`;
    expect(validateWorkflowSource(workflow, 'unsafe.yml')).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/pull_request_target/),
        expect.stringMatching(/write permissions/),
        expect.stringMatching(/full commit SHA/),
        expect.stringMatching(/persist-credentials/),
        expect.stringMatching(/timeout-minutes/),
      ]),
    );
  });

  it('keeps Cloudflare credentials and deployment outside GitHub Actions', () => {
    const workflow = `permissions:\n  contents: read\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - run: wrangler deploy\n        env:\n          CLOUDFLARE_API_TOKEN: placeholder\n`;
    expect(validateWorkflowSource(workflow, 'deploy.yml')).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/must not receive Cloudflare credentials/),
        expect.stringMatching(/native Cloudflare Workers Builds/),
      ]),
    );
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
        'prepare:deploy',
      ].map((name) => [name, 'test']),
    );
    requiredScripts.build = 'node scripts/build-site.mjs';
    requiredScripts.check = 'node scripts/run-astro.mjs check';
    requiredScripts.dev = 'node scripts/run-astro.mjs dev';
    requiredScripts.preview = 'node scripts/run-astro.mjs preview';
    requiredScripts.sync = 'node scripts/run-astro.mjs sync';
    requiredScripts['cf:build'] =
      'npm run record-desk:validate && npm run validate:submissions && npm run build && npm run prepare:deploy && npm run validate:dist && npm run validate:site';
    requiredScripts['cf:deploy'] = 'node scripts/deploy-site.mjs';
    requiredScripts['cf:install'] = 'node scripts/install-locked.mjs';
    expect(
      validatePackageManifest({
        private: true,
        license: 'MIT',
        packageManager: 'npm@11.17.0',
        engines: { node: '24.19.0', npm: '11.17.0' },
        scripts: requiredScripts,
      }),
    ).toEqual([]);
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
