import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveNpmCli, retryLockedInstall } from '../../scripts/install-locked.mjs';

const success = { code: 0, output: 'installed', signal: null } as const;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })),
  );
});

describe('locked dependency install retry policy', () => {
  it('returns a successful first attempt without waiting', async () => {
    const runAttempt = vi.fn(async () => success);
    const waitImplementation = vi.fn(async () => undefined);
    await expect(retryLockedInstall({ runAttempt, waitImplementation })).resolves.toEqual({
      ...success,
      attempts: 1,
    });
    expect(runAttempt).toHaveBeenCalledTimes(1);
    expect(waitImplementation).not.toHaveBeenCalled();
  });

  it('retries only bounded EBUSY or EPERM install failures', async () => {
    const runAttempt = vi
      .fn()
      .mockResolvedValueOnce({ code: 1, output: 'npm error EBUSY', signal: null })
      .mockResolvedValueOnce({ code: 1, output: 'npm error EPERM', signal: null })
      .mockResolvedValueOnce(success);
    const waitImplementation = vi.fn(async () => undefined);
    const reportRetry = vi.fn();
    await expect(
      retryLockedInstall({ runAttempt, waitImplementation, reportRetry }),
    ).resolves.toEqual({ ...success, attempts: 3 });
    expect(waitImplementation).toHaveBeenNthCalledWith(1, 250);
    expect(waitImplementation).toHaveBeenNthCalledWith(2, 500);
    expect(reportRetry).toHaveBeenCalledTimes(2);
  });

  it('passes through a non-retryable failure immediately', async () => {
    const failure = { code: 1, output: 'npm error E401', signal: null } as const;
    const runAttempt = vi.fn(async () => failure);
    const waitImplementation = vi.fn(async () => undefined);
    await expect(retryLockedInstall({ runAttempt, waitImplementation })).resolves.toEqual({
      ...failure,
      attempts: 1,
    });
    expect(runAttempt).toHaveBeenCalledTimes(1);
    expect(waitImplementation).not.toHaveBeenCalled();
  });

  it('locks Windows Node and npm to the same project-local runtime', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'trinity-install-runtime-'));
    temporaryRoots.push(root);
    const runtime = path.join(root, '.tools', 'node');
    const npmCli = path.join(runtime, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const nodeExecutable = path.join(runtime, 'node.exe');
    const outsideNpm = path.join(root, 'outside-npm-cli.js');
    await mkdir(path.dirname(npmCli), { recursive: true });
    await writeFile(npmCli, '');
    await writeFile(nodeExecutable, '');
    await writeFile(outsideNpm, '');

    await expect(
      resolveNpmCli(npmCli, {
        execPath: nodeExecutable,
        platform: 'win32',
        projectRoot: root,
      }),
    ).resolves.toBe(await realpath(npmCli));
    await expect(
      resolveNpmCli(outsideNpm, {
        execPath: nodeExecutable,
        platform: 'win32',
        projectRoot: root,
      }),
    ).rejects.toThrow(/same project-local Node runtime/);
    await expect(
      resolveNpmCli(npmCli, {
        execPath: outsideNpm,
        platform: 'win32',
        projectRoot: root,
      }),
    ).rejects.toThrow(/project-local \.tools\/node\/node\.exe/);
  });
});
