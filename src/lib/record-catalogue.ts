import {
  CLASSIFICATION_LEVELS,
  PUBLICATION_STATES,
  RECORD_FAMILIES,
  type ClassificationLevel,
  type PublicationState,
  type RecordFamily,
  type SubmissionRecordData,
} from './submission-schema';

export const CATALOGUE_RECORD_TYPES = [
  'policy',
  'security-reference',
  'form-template',
  'completed-report',
] as const;

export const CATALOGUE_STATUSES = ['active', 'template', 'archived', 'superseded'] as const;

export const CATALOGUE_SORTS = ['effective-desc', 'record-id', 'title'] as const;

export type CatalogueRecordType = (typeof CATALOGUE_RECORD_TYPES)[number];
export type CatalogueStatus = (typeof CATALOGUE_STATUSES)[number];
export type CatalogueSort = (typeof CATALOGUE_SORTS)[number];

export interface RecordCatalogueEntry {
  recordId: string;
  title: string;
  recordType: CatalogueRecordType;
  recordFamily: RecordFamily;
  status: CatalogueStatus;
  publicationState: PublicationState;
  revision: string;
  effectiveDate?: string;
  controllingOffice?: string;
  informationLevel?: ClassificationLevel;
  tags: string[];
  href: string;
}

export interface RecordCatalogueFilters {
  query: string;
  recordType: '' | CatalogueRecordType;
  recordFamily: '' | RecordFamily;
  status: '' | CatalogueStatus;
  publicationState: '' | PublicationState;
  informationLevel: '' | ClassificationLevel;
}

export interface CatalogueDocumentData {
  title: string;
  recordId?: string;
  recordType?: Exclude<CatalogueRecordType, 'completed-report'>;
  recordFamily?: RecordFamily;
  status?: CatalogueStatus;
  revision?: string;
  effectiveDate?: string;
  controllingOffice?: string;
  information?: { level: ClassificationLevel };
  tags?: string[];
}

export const EMPTY_CATALOGUE_FILTERS: Readonly<RecordCatalogueFilters> = Object.freeze({
  query: '',
  recordType: '',
  recordFamily: '',
  status: '',
  publicationState: '',
  informationLevel: '',
});

export const RECORD_TYPE_LABELS: Readonly<Record<CatalogueRecordType, string>> = Object.freeze({
  policy: 'Policy',
  'security-reference': 'Security reference',
  'form-template': 'Form template',
  'completed-report': 'Completed report',
});

export { CLASSIFICATION_LEVELS, PUBLICATION_STATES, RECORD_FAMILIES };

function documentHref(collectionId: string): string {
  const normalized = collectionId.replace(/^\/+|\/+$/g, '');
  return `/${normalized}/`;
}

function displayTitle(recordId: string, title: string): string {
  return title.replace(
    new RegExp(`^${recordId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+[—-]\\s+`),
    '',
  );
}

export function catalogueEntryFromDocument(
  collectionId: string,
  data: CatalogueDocumentData,
): RecordCatalogueEntry | null {
  if (!data.recordId || !data.recordType || !data.recordFamily || !data.status || !data.revision) {
    return null;
  }

  return {
    recordId: data.recordId,
    title: displayTitle(data.recordId, data.title),
    recordType: data.recordType,
    recordFamily: data.recordFamily,
    status: data.status,
    publicationState: 'released',
    revision: data.revision,
    effectiveDate: data.effectiveDate,
    controllingOffice: data.controllingOffice,
    informationLevel: data.information?.level,
    tags: data.tags ?? [],
    href: documentHref(collectionId),
  };
}

export function catalogueEntryFromSubmission(
  submission: SubmissionRecordData,
): RecordCatalogueEntry {
  return {
    recordId: submission.recordId,
    title: submission.title,
    recordType: 'completed-report',
    recordFamily: submission.recordFamily,
    status: submission.status,
    publicationState: submission.publicationState,
    revision: submission.revision,
    effectiveDate: submission.effectiveDate,
    controllingOffice: submission.controllingOffice,
    informationLevel: submission.information.level,
    tags: submission.tags,
    href: `/records/reports/${submission.recordId.toLowerCase()}/`,
  };
}

function normalizeSearchValue(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

export function recordMatchesCatalogueFilters(
  entry: RecordCatalogueEntry,
  filters: RecordCatalogueFilters,
): boolean {
  if (filters.recordType && entry.recordType !== filters.recordType) return false;
  if (filters.recordFamily && entry.recordFamily !== filters.recordFamily) return false;
  if (filters.status && entry.status !== filters.status) return false;
  if (filters.publicationState && entry.publicationState !== filters.publicationState) return false;
  if (filters.informationLevel && entry.informationLevel !== filters.informationLevel) return false;

  const terms = normalizeSearchValue(filters.query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const haystack = normalizeSearchValue(
    [
      entry.recordId,
      entry.title,
      RECORD_TYPE_LABELS[entry.recordType],
      entry.recordFamily,
      entry.status,
      entry.publicationState,
      entry.revision,
      entry.effectiveDate ?? '',
      entry.controllingOffice ?? '',
      entry.informationLevel ?? '',
      ...entry.tags,
    ].join(' '),
  );

  return terms.every((term) => haystack.includes(term));
}

export function filterCatalogueEntries(
  entries: readonly RecordCatalogueEntry[],
  filters: RecordCatalogueFilters,
): RecordCatalogueEntry[] {
  return entries.filter((entry) => recordMatchesCatalogueFilters(entry, filters));
}

export function sortCatalogueEntries(
  entries: readonly RecordCatalogueEntry[],
  sort: CatalogueSort = 'effective-desc',
): RecordCatalogueEntry[] {
  return [...entries].sort((left, right) => {
    if (sort === 'record-id') return left.recordId.localeCompare(right.recordId);
    if (sort === 'title') {
      return left.title.localeCompare(right.title) || left.recordId.localeCompare(right.recordId);
    }

    const dateOrder = (right.effectiveDate ?? '').localeCompare(left.effectiveDate ?? '');
    return dateOrder || left.recordId.localeCompare(right.recordId);
  });
}
