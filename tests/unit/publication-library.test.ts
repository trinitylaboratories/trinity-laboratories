import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PUBLICATION_ROUTES } from '../../scripts/lib/site-contract.mjs';
import { CAPABILITIES } from '../../src/lib/capabilities';
import {
  buildPublicPublicationLibrary,
  PUBLICATION_CAPABILITIES,
  projectCompletedStudy,
  projectReleasedSubmission,
} from '../../src/lib/publications';
import type { SubmissionRecordData } from '../../src/lib/submission-schema';
import type { StudyData } from '../../src/lib/study-schema';

async function readJsonDirectory<T>(directory: string): Promise<T[]> {
  const filenames = (await readdir(directory)).filter((filename) => filename.endsWith('.json'));
  return Promise.all(
    filenames.map(async (filename) => {
      const contents = await readFile(path.join(directory, filename), 'utf8');
      return JSON.parse(contents) as T;
    }),
  );
}

async function publicationFixtures() {
  const [submissions, studies] = await Promise.all([
    readJsonDirectory<SubmissionRecordData>(path.join('src', 'content', 'submissions')),
    readJsonDirectory<StudyData>(path.join('src', 'content', 'studies')),
  ]);
  return { submissions, studies };
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') return keys;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return keys;
  }

  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    collectKeys(child, keys);
  }
  return keys;
}

describe('public publication projections', () => {
  it('publishes only the released technical notes and owner-approved completed summary', async () => {
    const { submissions, studies } = await publicationFixtures();
    const library = buildPublicPublicationLibrary(submissions, studies);

    expect(library).toHaveLength(14);
    expect(library.filter(({ kind }) => kind === 'technical-note')).toHaveLength(13);
    expect(library.filter(({ kind }) => kind === 'study-summary')).toHaveLength(1);
    expect(new Set(library.map(({ slug }) => slug)).size).toBe(library.length);
    expect(library.map(({ href }) => href).sort()).toEqual([...PUBLICATION_ROUTES].sort());
    expect(library[0]).toMatchObject({
      kind: 'study-summary',
      slug: 'st-24-018',
      href: '/publications/st-24-018/',
    });
  });

  it('keeps publication disciplines aligned with the public capability directory', () => {
    expect(Object.entries(PUBLICATION_CAPABILITIES)).toEqual(
      CAPABILITIES.map(({ title, slug }) => [title, slug]),
    );
  });

  it('rejects controlled research and personnel submissions', async () => {
    const { submissions } = await publicationFixtures();
    const controlledResearch = submissions.find(({ recordId }) => recordId === 'TL-220-AM-2303');
    const personnel = submissions.find(({ recordId }) => recordId === 'TL-P110-PER-9302');

    expect(controlledResearch).toBeDefined();
    expect(personnel).toBeDefined();
    expect(projectReleasedSubmission(controlledResearch!)).toBeNull();
    expect(projectReleasedSubmission(personnel!)).toBeNull();
  });

  it('omits internal fields, relationships, security metadata, and source identifiers', async () => {
    const { submissions, studies } = await publicationFixtures();
    const library = buildPublicPublicationLibrary(submissions, studies);
    const renderedProjection = JSON.stringify(library);

    const projectionKeys = collectKeys(library);
    for (const forbiddenKey of [
      'formId',
      'recordId',
      'relatedRecords',
      'relatedRecordIds',
      'information',
      'physicalAccess',
      'facilityCondition',
      'controllingOffice',
      'sections',
    ]) {
      expect(projectionKeys).not.toContain(forbiddenKey);
    }

    for (const forbiddenValue of [
      'INS-WO-',
      'TP-014',
      'REF-006',
      'DB-002',
      '_IgnoreThis',
      'Dropbox',
    ]) {
      expect(renderedProjection).not.toContain(forbiddenValue);
    }
  });

  it('requires a completed, owner-approved study with a public summary', async () => {
    const { studies } = await publicationFixtures();
    const completed = studies.find(({ studyId }) => studyId === 'ST-24-018');

    expect(completed).toBeDefined();
    expect(projectCompletedStudy(completed!)).toMatchObject({
      kind: 'study-summary',
      observation: completed!.publicSummary,
      relatedStudy: { href: '/studies/small-sensor-display-agreement/' },
    });
    expect(projectCompletedStudy({ ...completed!, editorialState: 'proposal' })).toBeNull();
    expect(projectCompletedStudy({ ...completed!, publicSummary: undefined })).toBeNull();
  });
});
