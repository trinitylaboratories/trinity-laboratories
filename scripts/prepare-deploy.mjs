import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isMain, optionalString, parseArgs } from './lib/cli.mjs';
import {
  assertDeploymentEnvironment,
  buildHeaders,
  buildRobots,
  extractInlineScriptHashes,
  inferDeploymentEnvironment,
} from './lib/deployment-policy.mjs';
import { walkFiles } from './lib/filesystem.mjs';

const RETRYABLE_REMOVE_CODES = new Set(['EACCES', 'EBUSY', 'EPERM']);

export async function unlinkWithRetry(
  filePath,
  { unlinkFile = unlink, retries = 8, retryDelayMs = 125 } = {},
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await unlinkFile(filePath);
      return;
    } catch (error) {
      if (attempt >= retries || !RETRYABLE_REMOVE_CODES.has(error?.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}

export async function prepareDeploy({
  dist = 'dist',
  environment,
  unlinkFile = unlink,
  retryDelayMs = 125,
}) {
  assertDeploymentEnvironment(environment);

  const projectRoot = process.cwd();
  const distRoot = path.resolve(projectRoot, dist);
  const relativeDist = path.relative(projectRoot, distRoot);

  if (
    relativeDist === '' ||
    relativeDist === '.' ||
    relativeDist.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeDist)
  ) {
    throw new Error(`Refusing to prepare an unsafe build directory: ${distRoot}`);
  }

  const distStats = await stat(distRoot).catch(() => null);
  if (!distStats?.isDirectory()) {
    throw new Error(`Build directory does not exist: ${distRoot}`);
  }

  const indexPath = path.join(distRoot, 'index.html');
  const indexStats = await stat(indexPath).catch(() => null);
  if (!indexStats?.isFile()) {
    throw new Error(`Build directory has no index.html: ${distRoot}`);
  }

  await mkdir(distRoot, { recursive: true });
  const builtFiles = await walkFiles(distRoot, { ignoredDirectories: new Set() });
  const scriptHashes = new Set();
  for (const relativeFile of builtFiles.filter((file) => /\.html$/i.test(file))) {
    const html = await readFile(path.join(distRoot, relativeFile), 'utf8');
    for (const hash of extractInlineScriptHashes(html)) scriptHashes.add(hash);
  }
  const outputs = new Map([
    [
      path.join(distRoot, '_headers'),
      buildHeaders(environment, { scriptHashes: [...scriptHashes] }),
    ],
    [path.join(distRoot, 'robots.txt'), buildRobots(environment)],
  ]);

  const changed = [];
  for (const [filePath, contents] of outputs) {
    const current = await readFile(filePath, 'utf8').catch(() => null);
    if (current === contents) continue;
    await writeFile(filePath, contents, 'utf8');
    changed.push(path.relative(projectRoot, filePath));
  }

  const removed = [];
  if (environment === 'preview') {
    for (const relativeFile of builtFiles.filter((file) =>
      /^sitemap.*\.xml$/i.test(path.basename(file)),
    )) {
      const sitemapPath = path.join(distRoot, relativeFile);
      await unlinkWithRetry(sitemapPath, { unlinkFile, retryDelayMs });
      removed.push(path.relative(projectRoot, sitemapPath));
    }
  }

  return { changed, distRoot, environment, removed };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const environmentArgument = optionalString(args, 'environment', '');
  const environment = environmentArgument || inferDeploymentEnvironment();
  const dist = optionalString(args, 'dist', 'dist');
  const result = await prepareDeploy({ dist, environment });

  console.log(
    `Prepared ${path.relative(process.cwd(), result.distRoot)} for ${result.environment}; ${result.changed.length} file(s) updated, ${result.removed.length} sitemap file(s) removed.`,
  );
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
