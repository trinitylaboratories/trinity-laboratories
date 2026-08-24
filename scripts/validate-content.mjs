import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { isMain, optionalString, parseArgs, printErrors } from './lib/cli.mjs';
import { walkFiles } from './lib/filesystem.mjs';

export const LEGACY_INFORMATION_LEVELS = Object.freeze({
  I: 'TL-1',
  II: 'TL-2',
  III: 'TL-3',
  IV: 'TL-4',
  V: 'TL-5',
});

const REQUIRED_RECORD_STRINGS = Object.freeze([
  'recordId',
  'recordType',
  'recordFamily',
  'status',
  'revision',
]);

export function parseFrontmatter(source, fileName = 'content.md') {
  const match = source.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;

  const document = parseDocument(match[1], {
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw new Error(
      `${fileName}: invalid YAML frontmatter: ${document.errors.map(({ message }) => message).join('; ')}`,
    );
  }

  const value = document.toJS({ maxAliasCount: 0 });
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fileName}: frontmatter must be a YAML mapping`);
  }
  return value;
}

export async function validateContent({
  contentRoot = 'src/content/docs',
  publicRoot = 'public',
} = {}) {
  const absoluteContentRoot = path.resolve(contentRoot);
  const absolutePublicRoot = path.resolve(publicRoot);
  const errors = [];
  const records = [];
  const files = await walkFiles(absoluteContentRoot, { ignoredDirectories: new Set() }).catch(
    () => [],
  );

  if (files.length === 0) {
    return {
      errors: [`No content files found under ${path.relative(process.cwd(), absoluteContentRoot)}`],
      fileCount: 0,
      recordCount: 0,
    };
  }

  for (const relativeFile of files.filter((file) => /\.mdx?$/i.test(file))) {
    const fileName = path.posix.join(contentRoot.replaceAll('\\', '/'), relativeFile);
    const source = await readFile(path.join(absoluteContentRoot, relativeFile), 'utf8');
    let data;
    try {
      data = parseFrontmatter(source, fileName);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `${fileName}: invalid frontmatter`);
      continue;
    }
    if (data?.recordId !== undefined) records.push({ data, fileName });
  }

  const idOwners = new Map();
  const recordsById = new Map();
  for (const { data, fileName } of records) {
    for (const field of REQUIRED_RECORD_STRINGS) {
      if (typeof data[field] !== 'string' || data[field].trim() === '') {
        errors.push(`${fileName}: record metadata requires a non-empty ${field}`);
      }
    }

    const recordId = typeof data.recordId === 'string' ? data.recordId.trim() : '';
    if (recordId && !/^TL(?:-[A-Z0-9]+)+$/.test(recordId)) {
      errors.push(`${fileName}: recordId must use canonical uppercase TL-* notation (${recordId})`);
    }
    const normalizedId = recordId.toUpperCase();
    if (normalizedId) {
      const owner = idOwners.get(normalizedId);
      if (owner)
        errors.push(`${fileName}: duplicate recordId ${recordId}; first declared by ${owner}`);
      else {
        idOwners.set(normalizedId, fileName);
        recordsById.set(normalizedId, data);
      }
    }

    if (
      !data.information ||
      typeof data.information !== 'object' ||
      Array.isArray(data.information)
    ) {
      errors.push(`${fileName}: record metadata requires information.level`);
    } else if (typeof data.information.level !== 'string' || data.information.level.trim() === '') {
      errors.push(`${fileName}: record metadata requires information.level`);
    }

    if (!Array.isArray(data.tags) || data.tags.length === 0) {
      errors.push(`${fileName}: record metadata requires at least one tag`);
    } else if (data.tags.some((tag) => typeof tag !== 'string' || tag.trim() === '')) {
      errors.push(`${fileName}: tags must contain only non-empty strings`);
    } else if (new Set(data.tags.map((tag) => tag.toLowerCase())).size !== data.tags.length) {
      errors.push(`${fileName}: tags must not contain duplicates`);
    }

    if (
      (!Array.isArray(data.attachments) || data.attachments.length === 0) &&
      data.recordType !== 'security-reference'
    ) {
      errors.push(`${fileName}: record metadata requires at least one source attachment`);
    }

    if (data.legacyMarking !== undefined) {
      const legacyLevel = data.legacyMarking?.level;
      const expectedLevel = LEGACY_INFORMATION_LEVELS[legacyLevel];
      if (!expectedLevel) {
        errors.push(`${fileName}: legacyMarking.level must be I, II, III, IV, or V`);
      } else if (data.information?.level !== expectedLevel) {
        errors.push(
          `${fileName}: legacy Level ${legacyLevel} must map to information.level ${expectedLevel}`,
        );
      }
    }
  }

  for (const { data, fileName } of records) {
    const recordId = typeof data.recordId === 'string' ? data.recordId.trim() : '';
    const related = data.relatedRecords ?? [];
    if (!Array.isArray(related)) {
      errors.push(`${fileName}: relatedRecords must be an array of record IDs`);
    } else {
      const seen = new Set();
      for (const relatedId of related) {
        if (typeof relatedId !== 'string' || relatedId.trim() === '') {
          errors.push(`${fileName}: relatedRecords must contain non-empty record IDs`);
          continue;
        }
        if (relatedId.startsWith('/') || /^https?:/i.test(relatedId)) {
          errors.push(
            `${fileName}: relatedRecords entries are record IDs, not routes (${relatedId})`,
          );
          continue;
        }
        const normalizedRelatedId = relatedId.toUpperCase();
        if (seen.has(normalizedRelatedId)) {
          errors.push(`${fileName}: duplicate related record ${relatedId}`);
        }
        seen.add(normalizedRelatedId);
        if (normalizedRelatedId === recordId.toUpperCase()) {
          errors.push(`${fileName}: a record may not relate to itself (${relatedId})`);
        } else if (!idOwners.has(normalizedRelatedId)) {
          errors.push(`${fileName}: related record does not exist (${relatedId})`);
        } else if (relatedId !== normalizedRelatedId) {
          errors.push(
            `${fileName}: related record IDs must use canonical uppercase (${relatedId})`,
          );
        }
      }
    }

    if (
      data.recordType === 'security-reference' &&
      (!Array.isArray(data.attachments) || data.attachments.length === 0)
    ) {
      const hasAttachedPolicySource = Array.isArray(related)
        ? related.some((relatedId) => {
            if (typeof relatedId !== 'string') return false;
            const sourceRecord = recordsById.get(relatedId.toUpperCase());
            return sourceRecord?.recordType === 'policy' && sourceRecord.attachments?.length > 0;
          })
        : false;
      if (!hasAttachedPolicySource) {
        errors.push(
          `${fileName}: a derived security-reference without an attachment must relate to an attached policy record`,
        );
      }
    }

    if (!Array.isArray(data.attachments)) continue;
    const attachmentPaths = new Set();
    for (const [index, attachment] of data.attachments.entries()) {
      const label = `${fileName}: attachment ${index + 1}`;
      if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) {
        errors.push(`${label} must be a mapping`);
        continue;
      }
      for (const field of ['label', 'path', 'mediaType', 'sourceFilename', 'sha256']) {
        if (typeof attachment[field] !== 'string' || attachment[field].trim() === '') {
          errors.push(`${label} requires a non-empty ${field}`);
        }
      }

      const publicPath = typeof attachment.path === 'string' ? attachment.path : '';
      if (!publicPath.startsWith('/') || /[?#]/.test(publicPath)) {
        errors.push(`${label} path must be a root-relative public asset path (${publicPath})`);
        continue;
      }
      let decodedPath;
      try {
        decodedPath = decodeURIComponent(publicPath).slice(1);
      } catch {
        errors.push(`${label} path contains invalid URL encoding (${publicPath})`);
        continue;
      }
      const absoluteAttachment = path.resolve(absolutePublicRoot, decodedPath);
      const relativeAttachment = path.relative(absolutePublicRoot, absoluteAttachment);
      if (
        relativeAttachment === '' ||
        relativeAttachment.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeAttachment)
      ) {
        errors.push(`${label} path escapes the public directory (${publicPath})`);
        continue;
      }
      if (attachmentPaths.has(publicPath))
        errors.push(`${fileName}: duplicate attachment path ${publicPath}`);
      attachmentPaths.add(publicPath);

      const attachmentStats = await stat(absoluteAttachment).catch(() => null);
      if (!attachmentStats?.isFile()) {
        errors.push(`${label} does not exist under public (${publicPath})`);
        continue;
      }
      const expectedHash = typeof attachment.sha256 === 'string' ? attachment.sha256 : '';
      const actualHash = createHash('sha256')
        .update(await readFile(absoluteAttachment))
        .digest('hex');
      if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
        errors.push(`${label} sha256 must be 64 lowercase hexadecimal characters`);
      } else if (actualHash !== expectedHash) {
        errors.push(`${label} sha256 mismatch: expected ${expectedHash}, received ${actualHash}`);
      }
    }
  }

  return { errors: [...new Set(errors)], fileCount: files.length, recordCount: records.length };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await validateContent({
    contentRoot: optionalString(args, 'content', 'src/content/docs'),
    publicRoot: optionalString(args, 'public', 'public'),
  });
  printErrors('Content policy violations:', result.errors);
  if (result.errors.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.log(
    `Content policy passed for ${result.recordCount} record(s) across ${result.fileCount} content file(s).`,
  );
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
