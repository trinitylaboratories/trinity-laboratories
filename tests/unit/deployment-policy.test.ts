import { describe, expect, it } from 'vitest';
import { inferIndexability } from '../../scripts/build-site.mjs';
import {
  deploymentCommand,
  previewAlias,
  readGitDeploymentState,
} from '../../scripts/deploy-site.mjs';
import type { GitStateOptions } from '../../scripts/deploy-site.mjs';
import { astroArguments, astroChildEnvironment } from '../../scripts/run-astro.mjs';
import {
  buildHeaders,
  buildRobots,
  extractInlineScriptHashes,
  inferDeploymentEnvironment,
} from '../../scripts/lib/deployment-policy.mjs';

describe('deployment policy', () => {
  it('uses strict local-only security headers', () => {
    const headers = buildHeaders('production');
    const globalHeaders = headers.split('\n\n')[0];
    expect(headers).toContain("base-uri 'none'");
    expect(headers).toContain("form-action 'none'");
    expect(headers).toContain('Referrer-Policy: no-referrer');
    expect(headers).toContain('X-Content-Type-Options: nosniff');
    expect(headers).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(headers).toContain("font-src 'self'");
    expect(headers).toContain("img-src 'self'");
    expect(headers).not.toContain('data:');
    expect(headers).not.toMatch(/script-src[^;]*unsafe-inline/);
    const scriptDirective = headers.match(/script-src [^;\n]+/)?.[0].split(/\s+/);
    expect(scriptDirective).toContain("'wasm-unsafe-eval'");
    expect(scriptDirective).not.toContain("'unsafe-eval'");
    expect(globalHeaders).not.toMatch(/^\s*X-Robots-Tag:/m);
    expect(headers).toMatch(/workers\.dev\/\*\n\s+X-Robots-Tag: noindex/);
    expect(headers).toMatch(/\/portal\/\*\n\s+X-Robots-Tag: noindex, nofollow, noarchive/);
    expect(headers).toMatch(/\/records\/\*\n\s+X-Robots-Tag: noindex, nofollow, noarchive/);
    expect(headers).toMatch(
      /\/downloads\/forms\/\*\n\s+X-Robots-Tag: noindex, nofollow, noarchive/,
    );
    expect(headers).toMatch(
      /\/downloads\/policies\/\*\n\s+X-Robots-Tag: noindex, nofollow, noarchive/,
    );
    expect(headers).not.toContain('/records/reports/*');
  });

  it('allows emitted inline scripts only by their CSP hashes', () => {
    const hashes = extractInlineScriptHashes(
      '<script>window.ready = true;</script><script src="/app.js"></script>',
    );
    expect(hashes).toHaveLength(1);
    expect(hashes[0]).toMatch(/^sha256-/);
    expect(buildHeaders('production', { scriptHashes: hashes })).toContain(`'${hashes[0]}'`);
  });

  it('blocks preview crawling with independent controls', () => {
    expect(buildHeaders('preview')).toMatch(/\/\*\n(?:.|\n)*X-Robots-Tag: noindex/);
    expect(buildRobots('preview')).toBe('User-agent: *\nDisallow: /\n');
  });

  it('publishes the apex sitemap only in production robots', () => {
    expect(buildRobots('production')).toContain(
      'Sitemap: https://trinitylaboratories.org/sitemap-index.xml',
    );
  });

  it('infers deployment and HTML indexability from branch context', () => {
    expect(inferDeploymentEnvironment({ GITHUB_REF_NAME: 'main' })).toBe('production');
    expect(inferDeploymentEnvironment({ GITHUB_REF_NAME: 'feature' })).toBe('preview');
    expect(inferIndexability({ WORKERS_CI_BRANCH: 'main' })).toBe(true);
    expect(inferIndexability({ GITHUB_REF_NAME: 'pull/12/merge' })).toBe(false);
    expect(inferIndexability({ PUBLIC_INDEXABLE: 'false', GITHUB_REF_NAME: 'main' })).toBe(false);
    expect(() => inferIndexability({ PUBLIC_INDEXABLE: 'maybe' })).toThrow(/true or false/);
  });

  it('adds the clean-path config only for the Windows launcher child', () => {
    expect(astroArguments('check', [], {})).toEqual(['check']);
    expect(
      astroArguments('check', [], { TRINITY_ASTRO_CONFIG_FILE: '..\\..\\astro.config.mjs' }),
    ).toEqual(['check', '--config', '..\\..\\astro.config.mjs']);
    expect(
      astroArguments('dev', ['--config=custom.mjs'], {
        TRINITY_ASTRO_CONFIG_FILE: '..\\..\\astro.config.mjs',
      }),
    ).toEqual(['dev', '--config=custom.mjs']);
    expect(astroChildEnvironment('preview', { CODEX_THREAD_ID: 'fixture' })).toEqual({
      ASTRO_PREVIEW_BACKGROUND: '0',
      CODEX_THREAD_ID: 'fixture',
    });
    expect(astroChildEnvironment('dev', {})).toEqual({ ASTRO_DEV_BACKGROUND: '0' });
  });

  it('binds the apex only from main and uploads other branches as preview versions', () => {
    const cleanMain = { branch: 'main', clean: true, head: 'a'.repeat(40) };
    expect(deploymentCommand({ WORKERS_CI_BRANCH: 'main' }, cleanMain)).toEqual({
      args: ['deploy'],
      environment: 'production',
    });
    expect(deploymentCommand({ WORKERS_CI_BRANCH: 'Feature/My Change' })).toEqual({
      args: ['versions', 'upload', '--preview-alias', 'preview-feature-my-change'],
      environment: 'preview',
    });
    expect(previewAlias('')).toBe('preview-branch');
    const longestAlias = previewAlias(`feature/${'x'.repeat(100)}`);
    expect(longestAlias).toHaveLength(42);
    expect(`${longestAlias}-trinity-laboratories`).toHaveLength(63);
    expect(() =>
      deploymentCommand(
        { SITE_DEPLOYMENT_ENV: 'production', WORKERS_CI_BRANCH: 'feature' },
        cleanMain,
      ),
    ).toThrow(/Refusing a production deploy/);
  });

  it('requires production to be an attached, committed, clean main revision', () => {
    const cleanMain = { branch: 'main', clean: true, head: 'a'.repeat(40) };
    expect(deploymentCommand({ SITE_DEPLOYMENT_ENV: 'production' }, cleanMain)).toEqual({
      args: ['deploy'],
      environment: 'production',
    });
    expect(() =>
      deploymentCommand({ SITE_DEPLOYMENT_ENV: 'production' }, { ...cleanMain, branch: '' }),
    ).toThrow(/detached branch/);
    expect(() =>
      deploymentCommand({ SITE_DEPLOYMENT_ENV: 'production' }, { ...cleanMain, clean: false }),
    ).toThrow(/no nonignored untracked files/);
    expect(() =>
      deploymentCommand({ SITE_DEPLOYMENT_ENV: 'production' }, { ...cleanMain, head: '' }),
    ).toThrow(/resolvable committed Git HEAD/);
    expect(() => deploymentCommand({ SITE_DEPLOYMENT_ENV: 'production' })).toThrow(
      /verified Git repository state/,
    );

    const detached = { ...cleanMain, branch: '' };
    expect(
      deploymentCommand(
        {
          WORKERS_CI: '1',
          WORKERS_CI_BRANCH: 'main',
        },
        detached,
      ),
    ).toEqual({ args: ['deploy'], environment: 'production' });
    expect(
      deploymentCommand(
        {
          WORKERS_CI: '1',
          WORKERS_CI_BRANCH: 'main',
          WORKERS_CI_COMMIT_SHA: cleanMain.head,
        },
        detached,
      ),
    ).toEqual({ args: ['deploy'], environment: 'production' });
    expect(() =>
      deploymentCommand(
        {
          WORKERS_CI: '1',
          WORKERS_CI_BRANCH: 'main',
          WORKERS_CI_COMMIT_SHA: 'c'.repeat(40),
        },
        detached,
      ),
    ).toThrow(/detached branch/);
    expect(() =>
      deploymentCommand(
        {
          WORKERS_CI: '1',
          WORKERS_CI_BRANCH: 'main',
          WORKERS_CI_COMMIT_SHA: 'c'.repeat(40),
        },
        cleanMain,
      ),
    ).toThrow(/detached branch/);
    expect(
      deploymentCommand(
        {
          WORKERS_CI: '1',
          WORKERS_CI_BRANCH: 'main',
          WORKERS_CI_COMMIT_SHA: cleanMain.head,
        },
        cleanMain,
      ),
    ).toEqual({ args: ['deploy'], environment: 'production' });
  });

  it('reads branch, HEAD, and tracked-tree status with argument-array git calls', async () => {
    const calls: Array<{ args: readonly string[]; file: string; shell: unknown }> = [];
    const outputs = new Map([
      ['branch --show-current', 'main\n'],
      ['rev-parse --verify HEAD', `${'b'.repeat(40)}\n`],
      ['status --porcelain=v1 --untracked-files=normal', ''],
    ]);
    const execFileImplementation: NonNullable<GitStateOptions['execFileImplementation']> = (
      file,
      args,
      options,
      callback,
    ) => {
      calls.push({ args, file, shell: 'shell' in options ? options.shell : undefined });
      callback(null, outputs.get(args.join(' ')) ?? '', '');
      return {} as ReturnType<NonNullable<GitStateOptions['execFileImplementation']>>;
    };

    await expect(readGitDeploymentState({ execFileImplementation })).resolves.toEqual({
      branch: 'main',
      clean: true,
      head: 'b'.repeat(40),
    });
    expect(calls).toHaveLength(3);
    expect(calls.every(({ file, shell }) => file === 'git' && shell === undefined)).toBe(true);
  });
});
