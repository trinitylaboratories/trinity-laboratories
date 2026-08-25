import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  validateSubmissionDirectory,
  validateSubmissionRecord,
} from '../../scripts/validate-submissions.mjs';

async function fixture() {
  const filename = path.join(process.cwd(), 'src', 'content', 'submissions', 'tl-340-trn-001.json');
  return JSON.parse(await readFile(filename, 'utf8')) as Record<string, unknown>;
}

describe('completed submission policy', () => {
  it('validates the canonical submission directory and its related records', async () => {
    await expect(validateSubmissionDirectory(process.cwd())).resolves.toEqual({
      diagnostics: [],
      files: 4,
      records: 4,
    });
  });

  it('keeps information classification independent from physical access', async () => {
    const record = await fixture();

    expect(record.information).toEqual({ level: 'TL-3' });
    expect(record).not.toHaveProperty('physicalAccess');
    expect(validateSubmissionRecord(record)).toEqual([]);

    record.publicationState = 'released';
    expect(validateSubmissionRecord(record)).toEqual([]);
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
