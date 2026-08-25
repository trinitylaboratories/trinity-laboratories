import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  MAX_DRAFT_BYTES,
  assertPathInside,
  assertRecordMatchesDefinition,
  stableJson,
  toPublicRecord,
  validateDraftPackage,
} from '../tools/record-desk/core.mjs';
import { readStableUtf8File } from './lib/stable-file-read.mjs';
import { loadDefinitionCatalog } from './validate-form-definitions.mjs';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_OUTPUT_DIRECTORY = 'src/content/submissions';

export function parseImportArguments(argv) {
  if (argv.length === 0) {
    throw new Error(
      'Usage: import-record.mjs <file.tirn-draft.json> [--output-dir <repo-relative-dir>]',
    );
  }
  const inputPath = argv[0];
  let outputDirectory = DEFAULT_OUTPUT_DIRECTORY;
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] !== '--output-dir' || index + 1 >= argv.length) {
      throw new Error(
        'Usage: import-record.mjs <file.tirn-draft.json> [--output-dir <repo-relative-dir>]',
      );
    }
    outputDirectory = argv[index + 1];
    index += 1;
  }
  if (typeof inputPath !== 'string' || !inputPath.endsWith('.tirn-draft.json')) {
    throw new Error('Input must use the .tirn-draft.json extension.');
  }
  if (path.isAbsolute(outputDirectory))
    throw new Error('--output-dir must be repository-relative.');
  return { inputPath, outputDirectory };
}

export async function readCurrentBranch(root = PROJECT_ROOT) {
  const dotGit = path.join(root, '.git');
  let gitDirectory = dotGit;
  const gitEntry = await readStableUtf8File(dotGit, {
    label: 'Repository Git entry',
    maxBytes: 16 * 1024,
    allowDirectory: true,
  });
  if (gitEntry.kind === 'file') {
    const pointer = gitEntry.text.trim();
    const match = pointer.match(/^gitdir:\s*(.+)$/i);
    if (!match) throw new Error('Unable to resolve the repository Git directory.');
    gitDirectory = path.resolve(root, match[1]);
  }
  const headFile = await readStableUtf8File(path.join(gitDirectory, 'HEAD'), {
    label: 'Repository HEAD',
    maxBytes: 16 * 1024,
  });
  const head = headFile.text.trim();
  const match = head.match(/^ref:\s*refs\/heads\/(.+)$/);
  return match ? match[1] : null;
}

export function assertImportBranch(branch) {
  if (branch === 'main') {
    throw new Error(
      'Record import is refused on main. Create or switch to a working branch first.',
    );
  }
  if (!branch) {
    throw new Error(
      'Record import is refused from a detached HEAD. Switch to a working branch first.',
    );
  }
  return branch;
}

async function walkFiles(directory, extension) {
  const output = [];
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return output;
    throw error;
  }
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await walkFiles(target, extension)));
    else if (entry.isFile() && entry.name.endsWith(extension)) output.push(target);
  }
  return output;
}

async function collectKnownRecordIds(root, catalog) {
  const ids = new Set(catalog.templates.map((template) => template.templateId));
  for (const extension of ['.md', '.mdx']) {
    const docsRoot = path.join(root, 'src', 'content', 'docs');
    for (const filename of await walkFiles(docsRoot, extension)) {
      const source = await fs.readFile(filename, 'utf8');
      const match = source.match(/^recordId:\s*['"]?([^'"\r\n]+)['"]?\s*$/m);
      if (match) ids.add(match[1].trim());
    }
  }
  const submissionsRoot = path.join(root, 'src', 'content', 'submissions');
  for (const filename of await walkFiles(submissionsRoot, '.json')) {
    try {
      const record = JSON.parse(await fs.readFile(filename, 'utf8'));
      if (record && typeof record.recordId === 'string') ids.add(record.recordId);
    } catch (error) {
      throw new Error(`Existing submission is not valid JSON: ${path.relative(root, filename)}.`, {
        cause: error,
      });
    }
  }
  return ids;
}

async function realPathInside(root, candidate, label) {
  const lexical = assertPathInside(root, candidate, label);
  const realRoot = await fs.realpath(root);
  const realCandidate = await fs.realpath(lexical);
  return assertPathInside(realRoot, realCandidate, label);
}

/**
 * @param {{
 *   root?: string,
 *   inputPath?: string,
 *   outputDirectory?: string,
 *   branch?: string | null
 * }} [options]
 */
export async function stageDraftPackage({
  root = PROJECT_ROOT,
  inputPath,
  outputDirectory = DEFAULT_OUTPUT_DIRECTORY,
  branch,
} = {}) {
  const physicalRoot = await fs.realpath(root);
  const activeBranch = branch === undefined ? await readCurrentBranch(physicalRoot) : branch;
  assertImportBranch(activeBranch);
  if (typeof inputPath !== 'string' || !inputPath.endsWith('.tirn-draft.json')) {
    throw new Error('Input must use the .tirn-draft.json extension.');
  }
  const sourcePath = await realPathInside(
    physicalRoot,
    path.resolve(physicalRoot, inputPath),
    'Input path',
  );
  const sourceFile = await readStableUtf8File(sourcePath, {
    label: 'Draft package',
    maxBytes: MAX_DRAFT_BYTES,
  });
  const source = sourceFile.text;
  let draft;
  try {
    draft = JSON.parse(source);
  } catch {
    throw new Error('Draft package is not valid JSON.');
  }
  validateDraftPackage(draft, { forPublication: true });

  const catalog = await loadDefinitionCatalog(
    path.join(physicalRoot, 'data', 'form-definitions', 'forms.json'),
  );
  const definition = catalog.templates.find((template) => template.templateId === draft.templateId);
  if (!definition) throw new Error(`Unknown form template: ${draft.templateId}.`);
  if (draft.record.recordFamily !== definition.family) {
    throw new Error('record.recordFamily does not match the selected form template.');
  }
  assertRecordMatchesDefinition(draft, definition);

  const publicRecord = toPublicRecord(draft);
  const knownRecordIds = await collectKnownRecordIds(physicalRoot, catalog);
  if (knownRecordIds.has(publicRecord.recordId)) {
    throw new Error(`Record ID already exists in the repository: ${publicRecord.recordId}.`);
  }
  for (const relatedId of publicRecord.relatedRecords) {
    if (!knownRecordIds.has(relatedId)) {
      throw new Error(`Related record does not exist in the repository: ${relatedId}.`);
    }
  }

  const destinationDirectory = assertPathInside(
    physicalRoot,
    path.resolve(physicalRoot, outputDirectory),
    'Output directory',
  );
  await fs.mkdir(destinationDirectory, { recursive: true });
  const realDestinationDirectory = await realPathInside(
    physicalRoot,
    destinationDirectory,
    'Output directory',
  );
  const filename = `${draft.record.recordId.toLowerCase()}.json`;
  const destinationPath = assertPathInside(
    realDestinationDirectory,
    path.join(realDestinationDirectory, filename),
    'Destination path',
  );
  try {
    await fs.writeFile(destinationPath, stableJson(publicRecord), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EEXIST') {
      throw new Error(
        `Destination already exists: ${path.relative(physicalRoot, destinationPath)}.`,
        {
          cause: error,
        },
      );
    }
    throw error;
  }
  return {
    branch: activeBranch,
    destinationPath,
    relativePath: path.relative(physicalRoot, destinationPath).replaceAll('\\', '/'),
    publicRecord,
  };
}

async function main() {
  const options = parseImportArguments(process.argv.slice(2));
  const result = await stageDraftPackage(options);
  console.log(`Staged ${result.publicRecord.recordId} at ${result.relativePath}.`);
  console.log('Review the generated JSON and repository diff before opening a pull request.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
