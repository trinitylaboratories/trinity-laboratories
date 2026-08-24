import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './lib/cli.mjs';
import {
  discardLocalBuildStage,
  prepareLocalBuildStage,
  publishLocalBuild,
  resolveLocalBuildPaths,
} from './lib/local-build-stage.mjs';

export function inferIndexability(env = process.env) {
  const explicit = env.PUBLIC_INDEXABLE?.trim().toLowerCase();
  if (explicit) {
    if (explicit === 'true') return true;
    if (explicit === 'false') return false;
    throw new Error('PUBLIC_INDEXABLE must be either true or false when set.');
  }

  const branch =
    env.WORKERS_CI_BRANCH?.trim() ||
    env.GITHUB_REF_NAME?.trim() ||
    env.CF_PAGES_BRANCH?.trim() ||
    '';
  return branch === 'main';
}

export async function withLocalPrerenderCleanup(paths, operation) {
  const originalRm = fs.promises.rm;
  const physicalPrerender = path.join(paths.stage, '.prerender');
  fs.promises.rm = async (target, options = {}) => {
    const targetPath = target instanceof URL ? fileURLToPath(target) : String(target);
    const tail = path.normalize(targetPath).split(path.sep).filter(Boolean).slice(-3);
    if (tail.join('/') === '.tools/build-dist/.prerender') {
      return originalRm(physicalPrerender, {
        ...options,
        maxRetries: Math.max(Number(options.maxRetries ?? 0), 12),
        retryDelay: Math.max(Number(options.retryDelay ?? 0), 150),
      });
    }
    return originalRm(target, options);
  };
  try {
    return await operation();
  } finally {
    fs.promises.rm = originalRm;
  }
}

export async function buildSite({ env = process.env, buildImplementation, root } = {}) {
  const indexable = inferIndexability(env);
  process.env.PUBLIC_INDEXABLE = String(indexable);

  // This import must remain dynamic: Astro evaluates config and layouts using
  // PUBLIC_INDEXABLE, so the value has to exist before Astro first loads.
  const build = buildImplementation ?? (await import('astro')).build;
  const buildRoot = root ?? new URL('../', import.meta.url);
  const configFile = env.TRINITY_ASTRO_CONFIG_FILE?.trim();
  const requestedStage = env.TRINITY_LOCAL_BUILD_STAGE?.trim();
  let localPaths;
  if (requestedStage) {
    const physicalRoot = env.TRINITY_PROJECT_ROOT?.trim();
    if (!physicalRoot) throw new Error('TRINITY_PROJECT_ROOT is required for a local staged build');
    localPaths = await resolveLocalBuildPaths(physicalRoot, requestedStage);
    await prepareLocalBuildStage(localPaths);
  }

  try {
    const buildOperation = () =>
      build({
        root: buildRoot,
        ...(configFile ? { configFile } : {}),
        ...(localPaths ? { outDir: fileURLToPath(new URL('.tools/build-dist/', buildRoot)) } : {}),
      });
    if (localPaths) await withLocalPrerenderCleanup(localPaths, buildOperation);
    else await buildOperation();
  } catch (error) {
    if (localPaths) await discardLocalBuildStage(localPaths);
    throw error;
  }
  if (localPaths) await publishLocalBuild(localPaths);
  return { configFile, indexable, root: fileURLToPath(buildRoot) };
}

async function main() {
  const result = await buildSite();
  console.log(
    `Astro build completed with PUBLIC_INDEXABLE=${String(result.indexable)} (${result.root}).`,
  );
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
