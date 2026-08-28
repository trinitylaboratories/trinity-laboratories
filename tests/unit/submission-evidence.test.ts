import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  validateSubmissionDirectory,
  validateSubmissionRecord,
} from '../../scripts/validate-submissions.mjs';

let record: Record<string, unknown>;
const temporaryRoots: string[] = [];

beforeEach(async () => {
  record = JSON.parse(
    await readFile(
      path.join(process.cwd(), 'src', 'content', 'submissions', 'tl-340-trn-001.json'),
      'utf8',
    ),
  ) as Record<string, unknown>;
});

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })),
  );
});

async function availableEvidenceFixture() {
  const parent = path.join(process.cwd(), '.tools', 'test-results');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'unit-evidence-'));
  temporaryRoots.push(root);
  await mkdir(path.join(root, 'src', 'content', 'docs', 'forms'), { recursive: true });
  await mkdir(path.join(root, 'src', 'content', 'submissions'), { recursive: true });
  await mkdir(path.join(root, 'public', 'portal', 'media', 'geospatial'), { recursive: true });
  await mkdir(path.join(root, 'data'), { recursive: true });

  const bytes = Buffer.from('controlled evidence derivative fixture');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const publicPath = '/portal/media/geospatial/survey-frame-a.webp';
  record.relatedRecords = ['TL-340'];
  record.evidence = [
    {
      id: 'survey-frame-a',
      label: 'Survey frame A',
      mode: 'available',
      path: publicPath,
      mediaType: 'image/webp',
      sourceFilename: 'survey-frame-a.jpg',
      sha256,
      width: 1600,
      height: 900,
      alt: 'Overhead survey frame showing a wooded field corridor.',
      caption: 'Reference frame prepared for controlled review.',
      credit: 'Source attribution retained with the approved derivative.',
    },
  ];

  await writeFile(
    path.join(root, 'src', 'content', 'docs', 'forms', 'tl-340.md'),
    '---\nrecordId: TL-340\n---\n',
    'utf8',
  );
  await writeFile(
    path.join(root, 'src', 'content', 'submissions', 'tl-340-trn-001.json'),
    `${JSON.stringify(record, null, 2)}\n`,
    'utf8',
  );
  const derivative = path.join(
    root,
    'public',
    'portal',
    'media',
    'geospatial',
    'survey-frame-a.webp',
  );
  await writeFile(derivative, bytes);
  const ledger = {
    assets: [{ derivative: { path: publicPath, sha256 } }],
  };
  const ledgerFilename = path.join(root, 'data', 'asset-ledger.json');
  await writeFile(ledgerFilename, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  return { root, derivative, ledgerFilename, ledger };
}

describe('controlled submission evidence', () => {
  it('accepts available plates and safe withheld descriptors', () => {
    record.evidence = [
      {
        id: 'survey-frame-a',
        label: 'Survey frame A',
        mode: 'available',
        path: '/portal/media/geospatial/survey-frame-a.webp',
        mediaType: 'image/webp',
        sourceFilename: 'survey-frame-a.jpg',
        sha256: 'a'.repeat(64),
        width: 1600,
        height: 900,
        alt: 'Overhead survey frame showing a wooded field corridor.',
        caption: 'Reference frame prepared for controlled review.',
        credit: 'Source attribution retained with the approved derivative.',
      },
      {
        id: 'survey-frame-b',
        label: 'Survey frame B',
        mode: 'withheld',
        summary: 'The source plate remains with the controlling office pending rights review.',
      },
    ];

    expect(validateSubmissionRecord(record)).toEqual([]);
  });

  it('keeps withheld descriptors pathless and rejects malformed available plates', () => {
    record.evidence = [
      {
        id: 'survey-frame-a',
        label: 'Survey frame A',
        mode: 'withheld',
        summary: 'Source plate held by the controlling office.',
        path: '/portal/media/geospatial/source.webp',
      },
      {
        id: 'survey-frame-b',
        label: 'Survey frame B',
        mode: 'available',
        path: 'https://example.com/source.jpg',
        mediaType: 'image/jpeg',
        sourceFilename: 'C:\\source.jpg',
        sha256: 'not-a-hash',
        width: 0,
        height: 90.5,
        alt: 'Frame.',
        caption: 'Caption.',
        credit: 'Credit.',
      },
    ];

    const errors = validateSubmissionRecord(record);
    expect(errors).toContain('record.evidence[0].path: unknown property');
    expect(errors).toContain(
      'record.evidence[1].path: expected a project-local WebP beneath /portal/media/geospatial/',
    );
    expect(errors).toContain('record.evidence[1].mediaType: must be "image/webp"');
    expect(errors).toContain(
      'record.evidence[1].sourceFilename: expected a source basename, not a path',
    );
    expect(errors).toContain('record.evidence[1].sha256: expected a lowercase SHA-256 value');
    expect(errors).toContain('record.evidence[1].width: expected an integer from 1 through 12000');
    expect(errors).toContain('record.evidence[1].height: expected an integer from 1 through 12000');
  });

  it('allows plates only on elevated controlled non-personnel reports', () => {
    record.evidence = [
      {
        id: 'source-plate',
        label: 'Source plate',
        mode: 'withheld',
        summary: 'Source plate held by the controlling office.',
      },
    ];
    record.publicationState = 'released';
    record.information = { level: 'TL-2' };

    const errors = validateSubmissionRecord(record);
    expect(errors).toContain(
      'record.evidence: evidence plates require a controlled publication state',
    );
    expect(errors).toContain(
      'record.evidence: evidence plates require TL-3 or higher classification',
    );
  });

  it('requires available derivatives to match both their bytes and the asset ledger', async () => {
    const { root } = await availableEvidenceFixture();

    await expect(validateSubmissionDirectory(root)).resolves.toEqual({
      diagnostics: [],
      files: 1,
      records: 1,
    });
  });

  it('rejects an available derivative when its bytes or ledger entry do not match', async () => {
    const { root, derivative, ledgerFilename, ledger } = await availableEvidenceFixture();
    await writeFile(derivative, 'changed evidence bytes', 'utf8');
    ledger.assets = [];
    await writeFile(ledgerFilename, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');

    const { diagnostics } = await validateSubmissionDirectory(root);
    const relativeRecord = path.join('src', 'content', 'submissions', 'tl-340-trn-001.json');
    expect(diagnostics).toContain(
      `${relativeRecord}: record.evidence[0].sha256: does not match the public derivative bytes`,
    );
    expect(diagnostics).toContain(
      `${relativeRecord}: record.evidence[0].path: no asset-ledger entry matches the evidence path and SHA-256`,
    );
  });

  it('rejects an available plate whose declared public derivative is missing', async () => {
    const { root, derivative } = await availableEvidenceFixture();
    await rm(derivative);

    const { diagnostics } = await validateSubmissionDirectory(root);
    const relativeRecord = path.join('src', 'content', 'submissions', 'tl-340-trn-001.json');
    expect(diagnostics).toContain(
      `${relativeRecord}: record.evidence[0].path: derivative is missing`,
    );
  });
});
