import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { REPORT_IDS } from '../../scripts/lib/site-contract.mjs';
import {
  validateSubmissionDirectory,
  validateSubmissionRecord,
} from '../../scripts/validate-submissions.mjs';

const temporaryRoots: string[] = [];

async function submissionFixtureRoot() {
  const parent = path.join(process.cwd(), '.tools', 'test-results');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'unit-submissions-'));
  temporaryRoots.push(root);
  await mkdir(path.join(root, 'src', 'content', 'docs', 'forms'), { recursive: true });
  await mkdir(path.join(root, 'src', 'content', 'docs', 'research'), { recursive: true });
  await mkdir(path.join(root, 'src', 'content', 'submissions'), { recursive: true });
  return root;
}

async function fixture() {
  const filename = path.join(process.cwd(), 'src', 'content', 'submissions', 'tl-340-trn-001.json');
  return JSON.parse(await readFile(filename, 'utf8')) as Record<string, unknown>;
}

async function personnelFixture() {
  const filename = path.join(
    process.cwd(),
    'src',
    'content',
    'submissions',
    'tl-p110-per-9302.json',
  );
  return JSON.parse(await readFile(filename, 'utf8')) as Record<string, unknown>;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })),
  );
});

describe('completed submission policy', () => {
  it('validates the canonical submission directory and its related records', async () => {
    await expect(validateSubmissionDirectory(process.cwd())).resolves.toEqual({
      diagnostics: [],
      files: 49,
      records: 49,
    });
  });

  it('keeps every submission filename in the monitored route contract', async () => {
    const filenames = (await readdir(path.join('src', 'content', 'submissions')))
      .filter((filename) => filename.endsWith('.json'))
      .map((filename) => path.basename(filename, '.json'))
      .sort();

    expect(filenames).toEqual([...REPORT_IDS].sort());
  });

  it('resolves related canonical record IDs declared by MDX documents', async () => {
    const root = await submissionFixtureRoot();
    const record = await fixture();
    record.relatedRecords = ['TL-340', 'TL-RSO-001'];

    await writeFile(
      path.join(root, 'src', 'content', 'docs', 'forms', 'tl-340.md'),
      '---\nrecordId: TL-340\n---\n',
      'utf8',
    );
    await writeFile(
      path.join(root, 'src', 'content', 'docs', 'research', 'tl-rso-001.mdx'),
      '---\nrecordId: TL-RSO-001\n---\n',
      'utf8',
    );
    await writeFile(
      path.join(root, 'src', 'content', 'submissions', 'tl-340-trn-001.json'),
      `${JSON.stringify(record, null, 2)}\n`,
      'utf8',
    );

    await expect(validateSubmissionDirectory(root)).resolves.toEqual({
      diagnostics: [],
      files: 1,
      records: 1,
    });
  });

  it('keeps information classification independent from physical access', async () => {
    const record = await fixture();

    expect(record.information).toEqual({ level: 'TL-3' });
    expect(record).not.toHaveProperty('physicalAccess');
    expect(validateSubmissionRecord(record)).toEqual([]);

    record.publicationState = 'released';
    expect(validateSubmissionRecord(record)).toContain(
      'record.publicationState: TL-3+ records may not be released',
    );
  });

  it('keeps fictional personnel metadata generic and separately controlled', async () => {
    const record = await personnelFixture();

    expect(validateSubmissionRecord(record)).toEqual([]);
    expect(record).toMatchObject({
      recordId: 'TL-P110-PER-9302',
      formId: 'TL-P110',
      title: 'Personnel Assignment Record — File 9302',
      recordFamily: 'personnel',
      controllingOffice: 'Personnel Office',
      publicationState: 'controlled',
      information: { level: 'TL-3' },
    });
    expect(record).not.toHaveProperty('physicalAccess');
    expect(record).not.toHaveProperty('facilityCondition');

    const metadata = JSON.stringify({
      title: record.title,
      summary: record.summary,
      tags: record.tags,
      controllingOffice: record.controllingOffice,
    });
    expect(metadata).not.toContain('Mara Venn');
  });

  it('rejects unsafe personnel form, access, publication, and metadata choices', async () => {
    const record = await personnelFixture();
    record.formId = 'TL-P365';
    record.publicationState = 'released';
    record.information = { level: 'TL-2' };
    record.physicalAccess = { level: 'S-2', endorsements: [] };
    record.facilityCondition = 'WHITE';
    record.controllingOffice = 'Advanced Materials';
    record.title = 'Named employee assignment';
    record.summary = 'A descriptive personnel summary.';
    record.tags = ['personnel', 'Mara-Venn'];

    const errors = validateSubmissionRecord(record);
    expect(errors).toContain('record.formId: personnel records must originate from TL-P110');
    expect(errors).toContain('record.information.level: personnel records must be TL-3 or TL-4');
    expect(errors).toContain('record.publicationState: personnel records must be controlled');
    expect(errors).toContain(
      'record.physicalAccess: personnel records must not publish physical-access data',
    );
    expect(errors).toContain(
      'record.facilityCondition: personnel records must not publish facility conditions',
    );
    expect(errors).toContain(
      'record.controllingOffice: personnel records must use the generic Personnel Office',
    );
    expect(errors).toContain(
      'record.title: personnel records must use the generic file-number title',
    );
    expect(errors).toContain(
      'record.summary: personnel records must use the approved generic summary',
    );
    expect(errors).toContain(
      'record.tags[1]: personnel record tags must use the generic allowlist',
    );
  });

  it('rejects sensitive personal-data labels from personnel bodies', async () => {
    const record = await personnelFixture();
    const sections = record.sections as Array<Record<string, unknown>>;
    sections[0].body = `${String(sections[0].body)}\n\n**Home address:** prohibited`;

    expect(validateSubmissionRecord(record)).toContain(
      'record.sections: personnel records must not contain residential address',
    );
  });

  it('rejects a plaintext value on a withheld section', async () => {
    const record = await fixture();
    const sections = record.sections as Array<Record<string, unknown>>;
    sections[2].body = 'This value must never enter the public artifact.';

    expect(validateSubmissionRecord(record)).toContain('record.sections[2].body: unknown property');
    expect(validateSubmissionRecord(record)).toContain(
      'record.sections[2].body: withheld sections must not contain a body value',
    );
  });

  it('rejects invalid enums, duplicate section ids, and malformed dates', async () => {
    const record = await fixture();
    record.effectiveDate = '2026-02-30';
    record.publicationState = 'published';
    const sections = record.sections as Array<Record<string, unknown>>;
    sections[1].id = sections[0].id;

    const errors = validateSubmissionRecord(record);
    expect(errors).toContain(
      'record.effectiveDate: expected a real calendar date in YYYY-MM-DD form',
    );
    expect(errors).toContain('record.publicationState: unsupported value "published"');
    expect(errors).toContain('record.sections[1].id: duplicate section identifier');
  });

  it('rejects broken related records and a missing source-form relation', async () => {
    const record = await fixture();
    record.relatedRecords = ['TL-SEC-04', 'TL-NOT-REAL'];
    const knownRecordIds = new Set(['TL-SEC-04', 'TL-340-TRN-001']);

    const errors = validateSubmissionRecord(record, { knownRecordIds });
    expect(errors).toContain('record.relatedRecords[1]: unknown record id TL-NOT-REAL');
    expect(errors).toContain('record.relatedRecords: must include the source formId');
  });

  it('requires wholly withheld records to omit every section body', async () => {
    const record = await fixture();
    record.publicationState = 'withheld';

    const errors = validateSubmissionRecord(record);
    expect(errors).toContain(
      'record.sections[0].disclosure.mode: a withheld record may contain only withheld sections',
    );
    expect(errors).toContain(
      'record.sections[1].disclosure.mode: a withheld record may contain only withheld sections',
    );
  });
});
