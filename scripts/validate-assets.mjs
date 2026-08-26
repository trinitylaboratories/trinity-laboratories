import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { isMain, optionalString, parseArgs, printErrors } from './lib/cli.mjs';
import { pathExists, toPosix, walkFiles } from './lib/filesystem.mjs';

export const ASSET_LIMITS = Object.freeze({
  maxFiles: 20_000,
  maxFileBytes: 25 * 1024 * 1024,
  maxTotalBytes: 250 * 1024 * 1024,
});

const TYPE_BUDGETS = new Map([
  ['.css', 512 * 1024],
  ['.docx', 12 * 1024 * 1024],
  ['.gif', 4 * 1024 * 1024],
  ['.html', 512 * 1024],
  ['.jpeg', 4 * 1024 * 1024],
  ['.jpg', 4 * 1024 * 1024],
  ['.js', 1536 * 1024],
  ['.mjs', 1536 * 1024],
  ['.mp3', 12 * 1024 * 1024],
  ['.mp4', 24 * 1024 * 1024],
  ['.ogg', 12 * 1024 * 1024],
  ['.otf', 1024 * 1024],
  ['.pdf', 10 * 1024 * 1024],
  ['.png', 4 * 1024 * 1024],
  ['.svg', 512 * 1024],
  ['.ttf', 1024 * 1024],
  ['.webm', 24 * 1024 * 1024],
  ['.webp', 4 * 1024 * 1024],
  ['.woff', 1024 * 1024],
  ['.woff2', 1024 * 1024],
]);

const FORBIDDEN_EXTENSIONS = new Set([
  '.7z',
  '.ai',
  '.bmp',
  '.db',
  '.dll',
  '.dmg',
  '.exe',
  '.iso',
  '.key',
  '.map',
  '.p12',
  '.pem',
  '.pfx',
  '.psd',
  '.rar',
  '.raw',
  '.sqlite',
  '.tif',
  '.tiff',
  '.zip',
]);

const GENERATED_PUBLIC_PATHS = new Set(['/_headers', '/robots.txt']);

const APPROVED_ASSET_CATEGORIES = new Map([
  ['policy', { mediaTypes: new Set(['application/pdf']), prefix: '/downloads/policies/' }],
  [
    'blank-form',
    {
      mediaTypes: new Set([
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ]),
      prefix: '/downloads/forms/',
    },
  ],
  ['brand', { mediaTypes: new Set(['image/png', 'image/svg+xml']), prefix: '/media/brand/' }],
  [
    'facility-media',
    {
      mediaTypes: new Set(['image/webp']),
      prefix: '/media/facilities/',
      requiresProvenance: true,
    },
  ],
  [
    'third-party-font',
    {
      mediaTypes: new Set(['font/woff', 'font/woff2', 'font/otf', 'text/plain']),
      prefix: '/fonts/',
    },
  ],
]);

const FORBIDDEN_RELEASE_NAME_PATTERNS = Object.freeze([
  [
    'portrait or identity media',
    /(?:^|[/_.-])(?:portrait|headshot|selfie|passport[-_ ]?photo)(?:[/_.-]|$)/i,
  ],
  [
    'narrative or evidence media',
    /(?:^|[/_.-])(?:narrative|timeline|newspaper|news[-_ ]?clipping|case[-_ ]?evidence|baxtinite|longman)(?:[/_.-]|$)/i,
  ],
  [
    'prefilled or completed artifact',
    /(?:^|[/_.-])(?:pre[-_ ]?filled|completed[-_ ]?(?:badge|form)|filled[-_ ]?(?:badge|form))(?:[/_.-]|$)/i,
  ],
  [
    'credential or access-card media',
    /(?:^|[/_.-])(?:badges?|access[-_ ]?cards?|credential[-_ ]?(?:card|design)s?)(?:[/_.-]|$)/i,
  ],
]);

const MEDIA_TYPES = new Map([
  ['.avif', 'image/avif'],
  ['.css', 'text/css'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript'],
  ['.json', 'application/json'],
  ['.mjs', 'text/javascript'],
  ['.mp3', 'audio/mpeg'],
  ['.mp4', 'video/mp4'],
  ['.ogg', 'audio/ogg'],
  ['.otf', 'font/otf'],
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain'],
  ['.webm', 'video/webm'],
  ['.webmanifest', 'application/manifest+json'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.xml', 'application/xml'],
]);

export function validateSvg(source, fileName) {
  const errors = [];
  if (/<script\b/i.test(source)) errors.push(`${fileName}: SVG scripts are prohibited`);
  if (/\bon[a-z]+\s*=/i.test(source)) errors.push(`${fileName}: SVG event handlers are prohibited`);
  if (/<foreignObject\b/i.test(source)) errors.push(`${fileName}: SVG foreignObject is prohibited`);
  if (/\b(?:href|src)\s*=\s*["']https?:\/\//i.test(source)) {
    errors.push(`${fileName}: externally loaded SVG resources are prohibited`);
  }
  return errors;
}

export function validateStylesheet(source, fileName) {
  const errors = [];
  if (/@import\s+(?:url\()?\s*["']?https?:\/\//i.test(source)) {
    errors.push(`${fileName}: remote stylesheet imports are prohibited`);
  }
  if (/url\(\s*["']?https?:\/\//i.test(source)) {
    errors.push(`${fileName}: remote CSS assets are prohibited`);
  }
  return errors;
}

export function validateDocxArchive(bytes, fileName) {
  const errors = [];
  let expandedBytes = 0;
  let files;
  try {
    files = unzipSync(bytes, {
      filter(entry) {
        if (entry.name.includes('\\') || entry.name.split('/').includes('..')) {
          throw new Error(`unsafe ZIP entry path: ${entry.name}`);
        }
        expandedBytes += entry.originalSize;
        if (entry.originalSize > 8 * 1024 * 1024 || expandedBytes > 32 * 1024 * 1024) {
          throw new Error('expanded XML exceeds the DOCX inspection budget');
        }
        return /\.(?:xml|rels)$/i.test(entry.name);
      },
    });
  } catch (error) {
    return [
      `${fileName}: DOCX archive cannot be safely inspected (${error instanceof Error ? error.message : 'invalid ZIP'})`,
    ];
  }

  const entries = Object.entries(files);
  for (const [entryName, contents] of entries) {
    if (/^docProps\/custom\.xml$/i.test(entryName)) {
      errors.push(`${fileName}: DOCX custom properties are prohibited (${entryName})`);
    }
    if (
      /^word\/(?:comments|commentsExtended|commentsIds|people|threadedComments)[^/]*\.xml$/i.test(
        entryName,
      )
    ) {
      errors.push(`${fileName}: DOCX comment metadata part is prohibited (${entryName})`);
    }

    const xml = strFromU8(contents);
    if (/\.rels$/i.test(entryName)) {
      if (/\bTargetMode\s*=\s*["']External["']/i.test(xml)) {
        errors.push(`${fileName}: DOCX external relationship is prohibited (${entryName})`);
      }
      if (/\bTarget\s*=\s*["']\s*(?:https?|ftp|file):/i.test(xml)) {
        errors.push(`${fileName}: DOCX remote relationship target is prohibited (${entryName})`);
      }
    }
    if (
      /<w:(?:ins|del|moveFrom|moveTo|trackRevisions|commentRangeStart|commentRangeEnd|commentReference)\b/i.test(
        xml,
      ) ||
      /<w:[A-Za-z]+PrChange\b/i.test(xml)
    ) {
      errors.push(
        `${fileName}: DOCX tracked-change or comment markup is prohibited (${entryName})`,
      );
    }

    if (/^docProps\/core\.xml$/i.test(entryName)) {
      const sensitiveProperties = [
        'category',
        'contentStatus',
        'created',
        'creator',
        'description',
        'identifier',
        'keywords',
        'lastModifiedBy',
        'lastPrinted',
        'modified',
        'revision',
        'subject',
      ];
      for (const property of sensitiveProperties) {
        const match = xml.match(
          new RegExp(`<[^:>]+:${property}\\b[^>]*>([\\s\\S]*?)<\\/[^:>]+:${property}>`, 'i'),
        );
        if (match?.[1].replace(/<[^>]+>/g, '').trim()) {
          errors.push(`${fileName}: DOCX core property '${property}' must be empty`);
        }
      }
    }
    if (/^docProps\/app\.xml$/i.test(entryName)) {
      for (const property of [
        'Manager',
        'Company',
        'HyperlinkBase',
        'Template',
        'Application',
        'AppVersion',
        'TotalTime',
      ]) {
        const match = xml.match(
          new RegExp(`<${property}\\b[^>]*>([\\s\\S]*?)<\\/${property}>`, 'i'),
        );
        if (match?.[1].replace(/<[^>]+>/g, '').trim()) {
          errors.push(`${fileName}: DOCX extended property '${property}' must be empty`);
        }
      }
    }
  }
  return [...new Set(errors)];
}

export function validatePdfPrivacy(bytes, fileName) {
  const source = new TextDecoder('latin1').decode(bytes);
  const errors = [];
  if (/<\?xpacket\b|<x:xmpmeta\b|<rdf:RDF\b|\/Metadata\s+\d+\s+\d+\s+R\b/i.test(source)) {
    errors.push(`${fileName}: PDF XMP metadata is prohibited`);
  }
  for (const property of [
    'Author',
    'Creator',
    'Producer',
    'CreationDate',
    'ModDate',
    'Subject',
    'Keywords',
  ]) {
    const match = source.match(
      new RegExp(`/${property}\\s*(?:\\(([^)]*)\\)|<([^>]*)>|/([^\\s<>()]+))`, 'i'),
    );
    const value = match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
    if (value.replace(/\\[nrtbf()\\]/g, '').trim()) {
      errors.push(`${fileName}: PDF personal metadata '${property}' is prohibited`);
    }
  }
  return errors;
}

export function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function validatePngPrivacy(bytes, fileName) {
  const errors = [];
  const signature = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (bytes.length < signature.length || !signature.every((byte, index) => bytes[index] === byte)) {
    return [`${fileName}: malformed PNG signature`];
  }

  const forbiddenChunks = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'caBX']);
  let offset = signature.length;
  let chunkIndex = 0;
  let sawIdat = false;
  let sawIend = false;
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) {
      errors.push(`${fileName}: truncated PNG chunk header`);
      break;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.length - offset);
    const dataLength = view.getUint32(0, false);
    const chunkLength = 12 + dataLength;
    if (chunkLength > bytes.length - offset) {
      errors.push(`${fileName}: truncated PNG chunk payload`);
      break;
    }

    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = String.fromCharCode(...typeBytes);
    if (!/^[A-Za-z]{4}$/.test(type)) {
      errors.push(`${fileName}: malformed PNG chunk type`);
      break;
    }
    if (chunkIndex === 0 && (type !== 'IHDR' || dataLength !== 13)) {
      errors.push(`${fileName}: PNG must begin with a 13-byte IHDR chunk`);
    }
    if (forbiddenChunks.has(type)) {
      errors.push(`${fileName}: PNG metadata chunk ${type} is prohibited`);
    }
    if (type === 'IDAT') sawIdat = true;
    if (type === 'IEND') {
      if (dataLength !== 0) errors.push(`${fileName}: PNG IEND chunk must be empty`);
      sawIend = true;
    }

    const expectedCrc = view.getUint32(8 + dataLength, false);
    const actualCrc = pngCrc32(bytes.subarray(offset + 4, offset + 8 + dataLength));
    if (actualCrc !== expectedCrc) errors.push(`${fileName}: PNG chunk ${type} has an invalid CRC`);

    offset += chunkLength;
    chunkIndex += 1;
    if (sawIend) {
      if (offset !== bytes.length) errors.push(`${fileName}: PNG contains data after IEND`);
      break;
    }
  }

  if (!sawIdat) errors.push(`${fileName}: PNG contains no IDAT chunk`);
  if (!sawIend) errors.push(`${fileName}: PNG contains no IEND chunk`);
  return [...new Set(errors)];
}

export async function validateAssetRoot(root) {
  const absoluteRoot = path.resolve(root);
  const errors = [];
  if (!(await pathExists(absoluteRoot))) {
    return { errors: [`Asset root does not exist: ${absoluteRoot}`], fileCount: 0, totalBytes: 0 };
  }

  const files = await walkFiles(absoluteRoot, { ignoredDirectories: new Set() });
  let totalBytes = 0;

  if (files.length > ASSET_LIMITS.maxFiles) {
    errors.push(
      `${root}: ${files.length} files exceed Cloudflare's ${ASSET_LIMITS.maxFiles}-file limit`,
    );
  }

  for (const relativeFile of files) {
    const absoluteFile = path.join(absoluteRoot, relativeFile);
    const fileStats = await lstat(absoluteFile);
    const extension = path.extname(relativeFile).toLowerCase();
    totalBytes += fileStats.size;

    if (fileStats.isSymbolicLink()) {
      errors.push(`${relativeFile}: symbolic links are prohibited in deployable assets`);
      continue;
    }

    for (const [label, pattern] of FORBIDDEN_RELEASE_NAME_PATTERNS) {
      if (pattern.test(relativeFile))
        errors.push(`${relativeFile}: ${label} is outside the approved v1 release`);
    }

    if (/\s/.test(relativeFile))
      errors.push(`${relativeFile}: asset paths may not contain whitespace`);
    if (FORBIDDEN_EXTENSIONS.has(extension)) {
      errors.push(`${relativeFile}: '${extension}' files are prohibited in deployable assets`);
    }
    if (fileStats.size > ASSET_LIMITS.maxFileBytes) {
      errors.push(`${relativeFile}: exceeds Cloudflare's 25 MiB per-file limit`);
    }

    const budget = TYPE_BUDGETS.get(extension);
    if (budget && fileStats.size > budget) {
      errors.push(
        `${relativeFile}: ${formatBytes(fileStats.size)} exceeds the ${formatBytes(budget)} ${extension} budget`,
      );
    }

    if (extension === '.svg' && fileStats.size <= ASSET_LIMITS.maxFileBytes) {
      errors.push(...validateSvg(await readFile(absoluteFile, 'utf8'), relativeFile));
    }
    if (extension === '.css' && fileStats.size <= ASSET_LIMITS.maxFileBytes) {
      errors.push(...validateStylesheet(await readFile(absoluteFile, 'utf8'), relativeFile));
    }
    if (extension === '.docx' && fileStats.size <= ASSET_LIMITS.maxFileBytes) {
      errors.push(...validateDocxArchive(await readFile(absoluteFile), relativeFile));
    }
    if (extension === '.pdf' && fileStats.size <= ASSET_LIMITS.maxFileBytes) {
      errors.push(...validatePdfPrivacy(await readFile(absoluteFile), relativeFile));
    }
    if (extension === '.png' && fileStats.size <= ASSET_LIMITS.maxFileBytes) {
      errors.push(...validatePngPrivacy(await readFile(absoluteFile), relativeFile));
    }
  }

  if (totalBytes > ASSET_LIMITS.maxTotalBytes) {
    errors.push(
      `${root}: ${formatBytes(totalBytes)} exceeds the ${formatBytes(ASSET_LIMITS.maxTotalBytes)} deploy budget`,
    );
  }

  return { errors, fileCount: files.length, totalBytes };
}

export async function validateAssetLedger(
  publicRoot = 'public',
  ledgerPath = 'data/asset-ledger.json',
) {
  const absolutePublicRoot = path.resolve(publicRoot);
  const absoluteLedgerPath = path.resolve(ledgerPath);
  const errors = [];
  if (!(await pathExists(absolutePublicRoot))) {
    return { errors: [`Public asset root does not exist: ${absolutePublicRoot}`], entryCount: 0 };
  }
  if (!(await pathExists(absoluteLedgerPath))) {
    return { errors: [`Asset ledger does not exist: ${absoluteLedgerPath}`], entryCount: 0 };
  }

  let ledger;
  try {
    ledger = JSON.parse(await readFile(absoluteLedgerPath, 'utf8'));
  } catch (error) {
    return {
      errors: [
        `${path.relative(process.cwd(), absoluteLedgerPath)}: ${error instanceof Error ? error.message : 'invalid JSON'}`,
      ],
      entryCount: 0,
    };
  }

  if (ledger.hashAlgorithm !== 'SHA-256') {
    errors.push(`${ledgerPath}: hashAlgorithm must be SHA-256`);
  }
  if (!Array.isArray(ledger.assets)) {
    return { errors: [...errors, `${ledgerPath}: assets must be an array`], entryCount: 0 };
  }

  const entriesByPath = new Map();
  const pathOwners = new Map();
  const hashOwners = new Map();
  const sourceHashOwners = new Map();
  for (const [index, entry] of ledger.assets.entries()) {
    const label = `${ledgerPath}: asset ${index + 1}`;
    const deployedPath = entry?.derivative?.path;
    const expectedHash = entry?.derivative?.sha256;
    const sourceBasename = entry?.source?.basename;
    const sourceHash = entry?.source?.sha256;
    if (
      typeof deployedPath !== 'string' ||
      !deployedPath.startsWith('/') ||
      deployedPath.includes('\\') ||
      /[?#]/.test(deployedPath) ||
      path.posix.normalize(deployedPath) !== deployedPath
    ) {
      errors.push(`${label} requires a normalized root-relative derivative.path`);
      continue;
    }
    if (!/^\/[\x21-\x7e]+$/.test(deployedPath)) {
      errors.push(`${label} derivative.path must not contain whitespace or non-ASCII characters`);
    }
    if (GENERATED_PUBLIC_PATHS.has(deployedPath)) {
      errors.push(`${label} may not ledger generated deployment file ${deployedPath}`);
    }
    const previousPathOwner = pathOwners.get(deployedPath);
    if (previousPathOwner !== undefined) {
      errors.push(
        `${label} duplicates derivative.path from asset ${previousPathOwner + 1} (${deployedPath})`,
      );
    } else {
      pathOwners.set(deployedPath, index);
      entriesByPath.set(deployedPath, entry);
    }

    if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash)) {
      errors.push(`${label} derivative.sha256 must be 64 lowercase hexadecimal characters`);
    } else {
      const previousHashOwner = hashOwners.get(expectedHash);
      if (previousHashOwner !== undefined) {
        errors.push(
          `${label} duplicates derivative.sha256 from asset ${previousHashOwner + 1} (${expectedHash})`,
        );
      } else {
        hashOwners.set(expectedHash, index);
      }
    }

    if (typeof entry.license !== 'string' || entry.license.trim() === '') {
      errors.push(`${label} requires a non-empty license`);
    }
    if (typeof entry.ownership !== 'string' || entry.ownership.trim() === '') {
      errors.push(`${label} requires non-empty ownership`);
    }
    if (typeof entry.transform !== 'string' || entry.transform.trim() === '') {
      errors.push(`${label} requires a non-empty transform`);
    }
    if (typeof sourceBasename !== 'string' || sourceBasename.trim() === '') {
      errors.push(`${label} requires a non-empty source.basename`);
    } else if (/[\\/]/.test(sourceBasename)) {
      errors.push(`${label} source.basename must be a basename, not a path`);
    } else {
      for (const [scopeLabel, pattern] of FORBIDDEN_RELEASE_NAME_PATTERNS) {
        if (pattern.test(sourceBasename)) {
          errors.push(
            `${label} source.basename contains ${scopeLabel} outside the approved v1 release`,
          );
        }
      }
    }
    if (typeof sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(sourceHash)) {
      errors.push(`${label} source.sha256 must be 64 lowercase hexadecimal characters`);
    } else {
      const previousSourceOwner = sourceHashOwners.get(sourceHash);
      if (previousSourceOwner !== undefined) {
        errors.push(
          `${label} duplicates source.sha256 from asset ${previousSourceOwner + 1} (${sourceHash})`,
        );
      } else {
        sourceHashOwners.set(sourceHash, index);
      }
    }

    const categoryPolicy = APPROVED_ASSET_CATEGORIES.get(entry.category);
    if (!categoryPolicy) {
      errors.push(
        `${label} category is not approved for the v1 release (${String(entry.category)})`,
      );
    } else {
      if (!deployedPath.startsWith(categoryPolicy.prefix)) {
        errors.push(
          `${label} ${entry.category} assets must deploy beneath ${categoryPolicy.prefix}`,
        );
      }
      if (!categoryPolicy.mediaTypes.has(entry.mediaType)) {
        errors.push(
          `${label} ${entry.category} does not approve mediaType ${String(entry.mediaType)}`,
        );
      }
      if (
        categoryPolicy.requiresProvenance &&
        (typeof entry.provenance !== 'string' || entry.provenance.trim() === '')
      ) {
        errors.push(`${label} ${entry.category} requires non-empty provenance`);
      }
    }
    const expectedMediaType = MEDIA_TYPES.get(path.posix.extname(deployedPath).toLowerCase());
    if (!expectedMediaType) {
      errors.push(`${label} uses an unsupported media type extension (${deployedPath})`);
    } else if (entry.mediaType !== expectedMediaType) {
      errors.push(
        `${label} mediaType must be ${expectedMediaType} for ${deployedPath} (received ${String(entry.mediaType)})`,
      );
    }
  }

  const publicFiles = (await walkFiles(absolutePublicRoot, { ignoredDirectories: new Set() }))
    .map((file) => `/${toPosix(file)}`)
    .filter((file) => !GENERATED_PUBLIC_PATHS.has(file));
  const publicPaths = new Set(publicFiles);

  for (const publicPath of publicFiles) {
    if (!entriesByPath.has(publicPath)) {
      errors.push(`${publicPath}: deployed public asset is not listed in ${ledgerPath}`);
    }
  }

  for (const [deployedPath, entry] of entriesByPath) {
    if (!publicPaths.has(deployedPath)) {
      errors.push(`${ledgerPath}: ledgered derivative is missing from public (${deployedPath})`);
      continue;
    }
    const absoluteAsset = path.join(absolutePublicRoot, ...deployedPath.slice(1).split('/'));
    const actualHash = createHash('sha256')
      .update(await readFile(absoluteAsset))
      .digest('hex');
    if (actualHash !== entry.derivative.sha256) {
      errors.push(
        `${deployedPath}: SHA-256 mismatch; ledger has ${String(entry.derivative.sha256)}, file is ${actualHash}`,
      );
    }
  }

  return { errors, entryCount: ledger.assets.length, fileCount: publicFiles.length };
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const roots = optionalString(args, 'root', 'public')
    .split(',')
    .map((root) => root.trim())
    .filter(Boolean);
  const allErrors = [];
  if (roots.length === 0) throw new Error('--root must identify at least one asset directory');

  for (const root of roots) {
    const result = await validateAssetRoot(root);
    allErrors.push(...result.errors);
    console.log(`${root}: ${result.fileCount} asset(s), ${formatBytes(result.totalBytes)} total.`);
  }

  if (!args.has('skip-ledger')) {
    const ledgerPath = optionalString(args, 'ledger', 'data/asset-ledger.json');
    const ledgerResult = await validateAssetLedger(roots[0], ledgerPath);
    allErrors.push(...ledgerResult.errors);
    console.log(
      `${ledgerPath}: ${ledgerResult.entryCount} ledger entry or entries cover ${ledgerResult.fileCount ?? 0} public asset(s).`,
    );
  }

  printErrors('Asset policy violations:', allErrors);
  if (allErrors.length > 0) process.exitCode = 1;
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
