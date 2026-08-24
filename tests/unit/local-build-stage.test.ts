import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSite } from '../../scripts/build-site.mjs';
import {
  prepareLocalBuildStage,
  publishLocalBuild,
  resolveLocalBuildPaths,
} from '../../scripts/lib/local-build-stage.mjs';

const temporaryRoots: string[] = [];

async function fixtureRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'trinity-build-stage-'));
  temporaryRoots.push(root);
  await mkdir(path.join(root, '.tools'));
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })),
  );
});

describe('local build staging', () => {
  it('accepts only the exact generated paths beneath a physical .tools parent', async () => {
    const root = await fixtureRoot();
    const paths = await resolveLocalBuildPaths(root);
    expect(paths.stage).toBe(path.join(root, '.tools', 'build-dist'));
    expect(paths.backup).toBe(path.join(root, '.tools', 'previous-dist'));
    expect(paths.dist).toBe(path.join(root, 'dist'));
    await expect(resolveLocalBuildPaths(root, '../escape')).rejects.toThrow(/exactly/);
    await expect(
      resolveLocalBuildPaths(path.join(root, '.tools', 'workspace-root')),
    ).rejects.toThrow(/must not traverse/);
  });

  it('atomically publishes a completed stage over the previous dist', async () => {
    const root = await fixtureRoot();
    const paths = await resolveLocalBuildPaths(root);
    await prepareLocalBuildStage(paths, { platform: 'linux' });
    await mkdir(paths.dist);
    await writeFile(path.join(paths.dist, 'version.txt'), 'old');
    await writeFile(path.join(paths.stage, 'version.txt'), 'new');
    await publishLocalBuild(paths);
    expect(await readFile(path.join(paths.dist, 'version.txt'), 'utf8')).toBe('new');
    await expect(readFile(path.join(paths.backup, 'version.txt'), 'utf8')).rejects.toThrow();
  });

  it('preserves the previous dist when the staged Astro build fails', async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, 'dist'));
    await writeFile(path.join(root, 'dist', 'version.txt'), 'old');
    await expect(
      buildSite({
        root: pathToFileURL(`${root}${path.sep}`),
        env: {
          PUBLIC_INDEXABLE: 'true',
          TRINITY_LOCAL_BUILD_STAGE: '.tools/build-dist',
          TRINITY_PROJECT_ROOT: root,
        },
        buildImplementation: async () => {
          throw new Error('fixture build failure');
        },
      }),
    ).rejects.toThrow(/fixture build failure/);
    expect(await readFile(path.join(root, 'dist', 'version.txt'), 'utf8')).toBe('old');
  });

  it('rolls the previous dist back when the stage rename fails', async () => {
    const root = await fixtureRoot();
    const paths = await resolveLocalBuildPaths(root);
    await prepareLocalBuildStage(paths, { platform: 'linux' });
    await mkdir(paths.dist);
    await writeFile(path.join(paths.dist, 'version.txt'), 'old');
    await writeFile(path.join(paths.stage, 'version.txt'), 'new');
    let failed = false;
    const renamePath = async (source: string, destination: string) => {
      if (!failed && source === paths.stage && destination === paths.dist) {
        failed = true;
        throw new Error('fixture swap failure');
      }
      await rename(source, destination);
    };
    await expect(publishLocalBuild(paths, { renamePath })).rejects.toThrow(/fixture swap failure/);
    expect(await readFile(path.join(paths.dist, 'version.txt'), 'utf8')).toBe('old');
    expect(await readFile(path.join(paths.stage, 'version.txt'), 'utf8')).toBe('new');
  });

  it('uses a verified copy fallback when Windows refuses the stage rename', async () => {
    const root = await fixtureRoot();
    const paths = await resolveLocalBuildPaths(root);
    await prepareLocalBuildStage(paths, { platform: 'linux' });
    await mkdir(path.join(paths.stage, 'nested'));
    await mkdir(paths.dist);
    await writeFile(path.join(paths.dist, 'version.txt'), 'old');
    await writeFile(path.join(paths.stage, 'version.txt'), 'new');
    await writeFile(path.join(paths.stage, 'nested', 'asset.bin'), Buffer.from([0, 1, 2, 3]));

    const renamePath = async (source: string, destination: string) => {
      if (source === paths.stage && destination === paths.dist) {
        throw Object.assign(new Error('fixture Windows rename refusal'), { code: 'EPERM' });
      }
      await rename(source, destination);
    };

    await publishLocalBuild(paths, { renamePath, platform: 'linux' });
    expect(await readFile(path.join(paths.dist, 'version.txt'), 'utf8')).toBe('new');
    expect(await readFile(path.join(paths.dist, 'nested', 'asset.bin'))).toEqual(
      Buffer.from([0, 1, 2, 3]),
    );
    await expect(readFile(path.join(paths.stage, 'version.txt'), 'utf8')).rejects.toThrow();
    await expect(readFile(path.join(paths.backup, 'version.txt'), 'utf8')).rejects.toThrow();
  });

  it('removes a partial copy and restores the previous dist when copying fails', async () => {
    const root = await fixtureRoot();
    const paths = await resolveLocalBuildPaths(root);
    await prepareLocalBuildStage(paths, { platform: 'linux' });
    await mkdir(paths.dist);
    await writeFile(path.join(paths.dist, 'version.txt'), 'old');
    await writeFile(path.join(paths.stage, 'version.txt'), 'new');

    const renamePath = async (source: string, destination: string) => {
      if (source === paths.stage && destination === paths.dist) {
        throw Object.assign(new Error('fixture Windows rename refusal'), { code: 'EPERM' });
      }
      await rename(source, destination);
    };
    const copyPath = async (_source: string, destination: string) => {
      await mkdir(destination);
      await writeFile(path.join(destination, 'partial.txt'), 'partial');
      throw new Error('fixture copy failure');
    };

    await expect(
      publishLocalBuild(paths, { renamePath, copyPath, platform: 'linux' }),
    ).rejects.toThrow(/fixture copy failure/);
    expect(await readFile(path.join(paths.dist, 'version.txt'), 'utf8')).toBe('old');
    expect(await readFile(path.join(paths.stage, 'version.txt'), 'utf8')).toBe('new');
    await expect(readFile(path.join(paths.dist, 'partial.txt'), 'utf8')).rejects.toThrow();
    await expect(readFile(path.join(paths.backup, 'version.txt'), 'utf8')).rejects.toThrow();
  });

  it('rejects copy parity mismatches, restores old dist, and preserves the stage', async () => {
    const root = await fixtureRoot();
    const paths = await resolveLocalBuildPaths(root);
    await prepareLocalBuildStage(paths, { platform: 'linux' });
    await mkdir(paths.dist);
    await writeFile(path.join(paths.dist, 'version.txt'), 'old');
    await writeFile(path.join(paths.stage, 'version.txt'), 'new');

    const renamePath = async (source: string, destination: string) => {
      if (source === paths.stage && destination === paths.dist) {
        throw Object.assign(new Error('fixture Windows rename refusal'), { code: 'EPERM' });
      }
      await rename(source, destination);
    };
    const copyPath = async (source: string, destination: string) => {
      await cp(source, destination, { recursive: true });
      await writeFile(path.join(destination, 'version.txt'), 'corrupt');
    };

    await expect(
      publishLocalBuild(paths, { renamePath, copyPath, platform: 'linux' }),
    ).rejects.toThrow(/parity verification/);
    expect(await readFile(path.join(paths.dist, 'version.txt'), 'utf8')).toBe('old');
    expect(await readFile(path.join(paths.stage, 'version.txt'), 'utf8')).toBe('new');
    await expect(readFile(path.join(paths.backup, 'version.txt'), 'utf8')).rejects.toThrow();
  });
});
