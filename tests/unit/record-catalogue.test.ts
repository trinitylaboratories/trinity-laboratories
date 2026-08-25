import { describe, expect, it } from 'vitest';

import {
  catalogueEntryFromDocument,
  catalogueEntryFromSubmission,
  EMPTY_CATALOGUE_FILTERS,
  filterCatalogueEntries,
  recordMatchesCatalogueFilters,
  sortCatalogueEntries,
  type RecordCatalogueEntry,
} from '../../src/lib/record-catalogue';
import type { SubmissionRecordData } from '../../src/lib/submission-schema';

function entry(overrides: Partial<RecordCatalogueEntry> = {}): RecordCatalogueEntry {
  return {
    recordId: 'TL-101',
    title: 'Routine Research & Technical Activity Record',
    recordType: 'form-template',
    recordFamily: 'research',
    status: 'template',
    publicationState: 'controlled',
    revision: 'Source undated',
    informationLevel: 'TL-1',
    controllingOffice: 'Information Security & Records Division',
    tags: ['routine', 'instrumentation'],
    href: '/records/forms/tl-101/',
    ...overrides,
  };
}

describe('portal record catalogue', () => {
  it('normalizes canonical documents and omits non-record collection entries', () => {
    expect(
      catalogueEntryFromDocument('records/forms/tl-101', {
        title: 'TL-101 — Routine Research & Technical Activity Record',
        recordId: 'TL-101',
        recordType: 'form-template',
        recordFamily: 'research',
        status: 'template',
        revision: 'Source undated',
        information: { level: 'TL-1' },
        tags: ['routine'],
      }),
    ).toEqual(
      entry({
        controllingOffice: undefined,
        tags: ['routine'],
      }),
    );
    expect(
      catalogueEntryFromDocument('records/forms', {
        title: 'Forms Library',
      }),
    ).toBeNull();
  });

  it('keeps all internal templates controlled unless an explicit state says otherwise', () => {
    expect(
      catalogueEntryFromDocument('records/forms/tl-220', {
        title: 'TL-220 — Controlled Experimental Study Record',
        recordId: 'TL-220',
        recordType: 'form-template',
        recordFamily: 'research',
        status: 'template',
        revision: 'Source undated',
        information: { level: 'TL-2' },
      })?.publicationState,
    ).toBe('controlled');
    expect(
      catalogueEntryFromDocument('records/forms/tl-590', {
        title: 'TL-590 — Directorate record',
        recordId: 'TL-590',
        recordType: 'form-template',
        recordFamily: 'research',
        status: 'template',
        revision: 'Source undated',
        information: { level: 'TL-5' },
      })?.publicationState,
    ).toBe('controlled');
  });

  it('normalizes completed submissions into their report route', () => {
    const submission: SubmissionRecordData = {
      recordId: 'TL-340-TRN-001',
      formId: 'TL-340',
      title: 'Access-Control Training Assessment',
      recordType: 'completed-report',
      recordFamily: 'research',
      status: 'active',
      revision: '1.0',
      effectiveDate: '2026-08-24',
      controllingOffice: 'Information Security & Records Division',
      publicationState: 'controlled',
      information: { level: 'TL-3' },
      facilityCondition: 'WHITE',
      tags: ['training'],
      summary: 'Training record.',
      relatedRecords: ['TL-340'],
      sections: [
        {
          id: 'scope',
          title: 'Scope',
          disclosure: { mode: 'open' },
          body: 'Training only.',
        },
      ],
    };

    expect(catalogueEntryFromSubmission(submission)).toMatchObject({
      recordId: 'TL-340-TRN-001',
      recordType: 'completed-report',
      publicationState: 'controlled',
      informationLevel: 'TL-3',
      href: '/records/reports/tl-340-trn-001/',
    });
  });

  it('sorts effective records newest first, then undated records by identifier', () => {
    const entries = [
      entry({ recordId: 'TL-300', effectiveDate: undefined }),
      entry({ recordId: 'TL-200', effectiveDate: '2025-01-01' }),
      entry({ recordId: 'TL-100', effectiveDate: '2026-01-01' }),
      entry({ recordId: 'TL-250', effectiveDate: undefined }),
    ];

    expect(sortCatalogueEntries(entries).map(({ recordId }) => recordId)).toEqual([
      'TL-100',
      'TL-200',
      'TL-250',
      'TL-300',
    ]);
    expect(sortCatalogueEntries(entries, 'record-id').map(({ recordId }) => recordId)).toEqual([
      'TL-100',
      'TL-200',
      'TL-250',
      'TL-300',
    ]);
  });

  it('matches case-insensitive query terms across identifiers, offices, titles, and tags', () => {
    const record = entry();
    for (const query of [
      'tl-101',
      'routine instrumentation',
      'INFORMATION RECORDS',
      'form template',
    ]) {
      expect(recordMatchesCatalogueFilters(record, { ...EMPTY_CATALOGUE_FILTERS, query })).toBe(
        true,
      );
    }
    expect(
      recordMatchesCatalogueFilters(record, {
        ...EMPTY_CATALOGUE_FILTERS,
        query: 'routine personnel',
      }),
    ).toBe(false);
  });

  it('combines exact metadata filters and returns only matching records', () => {
    const records = [
      entry(),
      entry({
        recordId: 'TL-340-TRN-001',
        recordType: 'completed-report',
        status: 'active',
        publicationState: 'controlled',
        informationLevel: 'TL-3',
      }),
    ];

    expect(
      filterCatalogueEntries(records, {
        ...EMPTY_CATALOGUE_FILTERS,
        recordType: 'completed-report',
        status: 'active',
        publicationState: 'controlled',
        informationLevel: 'TL-3',
      }).map(({ recordId }) => recordId),
    ).toEqual(['TL-340-TRN-001']);
  });
});
