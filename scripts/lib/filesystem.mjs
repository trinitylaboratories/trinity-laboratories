import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.astro',
  '.cache',
  '.wrangler',
  'coverage',
  'dist',
  'node_modules',
  'output',
  'playwright-report',
  'test-results',
]);

export async function walkFiles(root, options = {}) {
  const ignoredDirectories = options.ignoredDirectories ?? DEFAULT_IGNORED_DIRECTORIES;
  const absoluteRoot = path.resolve(root);
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = toPosix(path.relative(absoluteRoot, absolutePath));

      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await visit(absolutePath);
        continue;
      }

      if (entry.isFile() || entry.isSymbolicLink()) files.push(relativePath);
    }
  }

  await visit(absoluteRoot);
  return files.sort((left, right) => left.localeCompare(right));
}

export async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return false;
    throw error;
  }
}

export function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}
