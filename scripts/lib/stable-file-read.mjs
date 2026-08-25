import { constants } from 'node:fs';
import fs from 'node:fs/promises';

const READ_WITHOUT_FOLLOWING =
  constants.O_RDONLY | (Number.isInteger(constants.O_NOFOLLOW) ? constants.O_NOFOLLOW : 0);

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

/** @typedef {{ kind: 'directory', text: null } | { kind: 'file', text: string }} StableReadResult */

/**
 * Read UTF-8 data through the same file handle that was validated.
 *
 * The post-open lstat check rejects a final-component link on platforms where
 * O_NOFOLLOW is unavailable and proves that the path still identifies the
 * opened object. Later path replacement cannot change the opened handle.
 *
 * @param {string} filename
 * @param {{ label?: string, maxBytes?: number, allowDirectory?: boolean }} [options]
 * @returns {Promise<StableReadResult>}
 */
export async function readStableUtf8File(
  filename,
  { label = 'File', maxBytes = Number.MAX_SAFE_INTEGER, allowDirectory = false } = {},
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new Error('Stable file read limit must be a non-negative safe integer.');
  }
  const handle = await fs.open(filename, READ_WITHOUT_FOLLOWING);
  try {
    const openedStat = await handle.stat({ bigint: true });
    const pathStat = await fs.lstat(filename, { bigint: true });
    if (!sameFile(openedStat, pathStat)) {
      throw new Error(`${label} changed while it was being opened.`);
    }
    if (openedStat.isDirectory()) {
      if (allowDirectory) return { kind: 'directory', text: null };
      throw new Error(`${label} must identify a regular file.`);
    }
    if (!openedStat.isFile() || !pathStat.isFile()) {
      throw new Error(`${label} must identify a regular file.`);
    }
    if (openedStat.size > BigInt(maxBytes)) {
      throw new Error(`${label} exceeds the ${maxBytes}-byte limit.`);
    }

    const text = await handle.readFile({ encoding: 'utf8' });
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new Error(`${label} exceeds the ${maxBytes}-byte limit.`);
    }
    return { kind: 'file', text };
  } finally {
    await handle.close();
  }
}
