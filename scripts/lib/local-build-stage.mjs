import { createHash } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

export const LOCAL_BUILD_STAGE = '.tools/build-dist';

function samePath(left, right) {
  return (
    path.resolve(left).localeCompare(path.resolve(right), undefined, { sensitivity: 'accent' }) ===
    0
  );
}

function assertExactChild(candidate, parent, baseName) {
  if (!samePath(path.dirname(candidate), parent) || path.basename(candidate) !== baseName) {
    throw new Error(`Unsafe generated path: ${candidate}`);
  }
}

async function rejectLink(candidate) {
  const stats = await lstat(candidate).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (stats?.isSymbolicLink())
    throw new Error(`Refusing generated symlink or junction: ${candidate}`);
  return stats;
}

async function requirePhysicalDirectory(candidate, label) {
  const stats = await rejectLink(candidate);
  if (!stats?.isDirectory()) {
    throw new Error(`${label} must be an existing physical directory: ${candidate}`);
  }
  const resolved = await realpath(candidate);
  if (!samePath(resolved, candidate)) {
    throw new Error(`${label} must resolve to its exact physical path: ${candidate}`);
  }
}

async function buildTreeManifest(root) {
  await requirePhysicalDirectory(root, 'Build tree');
  const manifest = new Map();

  async function visit(directory, relativeDirectory = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.posix.join(relativeDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Build tree contains a symlink or junction: ${absolute}`);
      }
      if (entry.isDirectory()) {
        manifest.set(`${relative}/`, 'directory');
        await visit(absolute, relative);
      } else if (entry.isFile()) {
        const bytes = await readFile(absolute);
        manifest.set(
          relative,
          `${bytes.byteLength}:${createHash('sha256').update(bytes).digest('hex')}`,
        );
      } else {
        throw new Error(`Build tree contains an unsupported filesystem entry: ${absolute}`);
      }
    }
  }

  await visit(root);
  return manifest;
}

function manifestsMatch(expected, actual) {
  if (expected.size !== actual.size) return false;
  for (const [relative, fingerprint] of expected) {
    if (actual.get(relative) !== fingerprint) return false;
  }
  return true;
}

function assertManifestMatch(expected, actual, label) {
  if (!manifestsMatch(expected, actual)) {
    throw new Error(`${label} failed closed-tree file, size, and SHA-256 parity verification`);
  }
}

export async function resolveLocalBuildPaths(projectRoot, requestedStage = LOCAL_BUILD_STAGE) {
  const normalizedRequest = requestedStage.replaceAll('\\', '/').replace(/^\.\//, '');
  if (normalizedRequest !== LOCAL_BUILD_STAGE) {
    throw new Error(`Local build stage must be exactly ${LOCAL_BUILD_STAGE}`);
  }
  if (projectRoot.replaceAll('\\', '/').includes('/.tools/workspace-root')) {
    throw new Error('Local build filesystem operations must not traverse the workspace junction');
  }

  const root = await realpath(projectRoot);
  const toolsExpected = path.join(root, '.tools');
  const tools = await realpath(toolsExpected);
  if (!samePath(tools, toolsExpected)) {
    throw new Error('The .tools directory must be a physical child of the project root');
  }

  const paths = {
    root,
    tools,
    stage: path.join(tools, 'build-dist'),
    backup: path.join(tools, 'previous-dist'),
    dist: path.join(root, 'dist'),
  };
  assertExactChild(paths.stage, tools, 'build-dist');
  assertExactChild(paths.backup, tools, 'previous-dist');
  assertExactChild(paths.dist, root, 'dist');
  return Object.freeze(paths);
}

async function clearGenerated(candidate, paths) {
  if (!samePath(candidate, paths.stage) && !samePath(candidate, paths.backup)) {
    throw new Error(`Refusing to clear unexpected generated path: ${candidate}`);
  }
  if (!(await rejectLink(candidate))) return;
  await rm(candidate, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
}

async function clearPartialDist(paths) {
  assertExactChild(paths.dist, paths.root, 'dist');
  if (!(await rejectLink(paths.dist))) return;
  await rm(paths.dist, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
}

function isCopyFallbackError(error) {
  return ['EACCES', 'EBUSY', 'EPERM', 'EXDEV'].includes(error?.code);
}

export async function prepareLocalBuildStage(paths, { platform = process.platform } = {}) {
  await clearGenerated(paths.stage, paths);
  await mkdir(paths.stage, { recursive: false });
  if (platform === 'win32') {
    await writeFile(`${paths.stage}:com.dropbox.ignored`, '1');
  }
}

export async function discardLocalBuildStage(paths) {
  await clearGenerated(paths.stage, paths);
}

export async function publishLocalBuild(
  paths,
  {
    renamePath = rename,
    copyPath = cp,
    platform = process.platform,
    onCleanupWarning = (error) => console.warn(error.message),
  } = {},
) {
  assertExactChild(paths.stage, paths.tools, 'build-dist');
  assertExactChild(paths.backup, paths.tools, 'previous-dist');
  assertExactChild(paths.dist, paths.root, 'dist');
  await requirePhysicalDirectory(paths.stage, 'Local build stage');
  const stageManifest = await buildTreeManifest(paths.stage);

  if (await rejectLink(paths.backup)) {
    throw new Error(`Refusing to replace an existing local build backup: ${paths.backup}`);
  }

  const previousDist = await rejectLink(paths.dist);
  if (previousDist && !previousDist.isDirectory()) {
    throw new Error(`Existing dist must be a physical directory: ${paths.dist}`);
  }
  const previousManifest = previousDist ? await buildTreeManifest(paths.dist) : null;
  let previousMoved = false;
  let stagePublished = false;
  let copyPublished = false;

  try {
    if (previousDist) {
      await renamePath(paths.dist, paths.backup);
      previousMoved = true;
      await requirePhysicalDirectory(paths.backup, 'Local build backup');
      assertManifestMatch(
        previousManifest,
        await buildTreeManifest(paths.backup),
        'Previous dist backup',
      );
    }

    try {
      await renamePath(paths.stage, paths.dist);
      stagePublished = true;
    } catch (error) {
      if (!isCopyFallbackError(error)) throw error;

      await requirePhysicalDirectory(paths.stage, 'Local build stage');
      assertManifestMatch(stageManifest, await buildTreeManifest(paths.stage), 'Staged build');
      await copyPath(paths.stage, paths.dist, {
        recursive: true,
        force: false,
        errorOnExist: true,
        preserveTimestamps: true,
      });
      copyPublished = true;

      const stageAfterCopy = await buildTreeManifest(paths.stage);
      assertManifestMatch(stageManifest, stageAfterCopy, 'Staged build');
      assertManifestMatch(stageAfterCopy, await buildTreeManifest(paths.dist), 'Published dist');
      if (platform === 'win32') {
        await writeFile(`${paths.dist}:com.dropbox.ignored`, '1');
      }
    }
  } catch (error) {
    try {
      if (stagePublished && (await rejectLink(paths.dist))) {
        await renamePath(paths.dist, paths.stage);
        stagePublished = false;
      }
      if (copyPublished || (await rejectLink(paths.dist))) {
        await requirePhysicalDirectory(paths.stage, 'Local build stage');
        assertManifestMatch(stageManifest, await buildTreeManifest(paths.stage), 'Staged build');
        if (previousMoved) {
          await requirePhysicalDirectory(paths.backup, 'Local build backup');
          assertManifestMatch(
            previousManifest,
            await buildTreeManifest(paths.backup),
            'Previous dist backup',
          );
        }
        await clearPartialDist(paths);
      }
      if (previousMoved) {
        await renamePath(paths.backup, paths.dist);
        previousMoved = false;
      }
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'Local build publish failed and the previous dist rollback also failed',
        { cause: rollbackError },
      );
    }
    throw error;
  }

  if (previousMoved) {
    try {
      await clearGenerated(paths.backup, paths);
    } catch (error) {
      onCleanupWarning(
        new Error(
          `Published dist successfully, but could not clear generated backup ${paths.backup}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        ),
      );
    }
  }

  if (copyPublished) {
    try {
      await clearGenerated(paths.stage, paths);
    } catch (error) {
      onCleanupWarning(
        new Error(
          `Published and verified dist successfully, but could not clear generated stage ${paths.stage}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        ),
      );
    }
  }
}
