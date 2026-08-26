import type { SubmissionRecordData } from './submission-schema';
import type { StudyData } from './study-schema';

export const PUBLICATION_CAPABILITIES = {
  'Advanced Materials': 'advanced-materials',
  'Industrial Instrumentation': 'industrial-instrumentation',
  'Environmental Analysis': 'environmental-analysis',
  'Applied Physics': 'applied-physics',
  'Field Sampling & Geological Research': 'field-sampling-geological-research',
  'Laboratory Safety Systems': 'laboratory-safety-systems',
  'Prototype Evaluation': 'prototype-evaluation',
  'Contract Research': 'contract-research',
} as const;

export type PublicPublicationDiscipline = keyof typeof PUBLICATION_CAPABILITIES;

interface PublicPublicationBase {
  slug: string;
  href: string;
  title: string;
  summary: string;
  discipline: PublicPublicationDiscipline;
  capabilityHref: string;
  dateLabel: string;
  sortKey: string;
}

export interface PublicTechnicalNote extends PublicPublicationBase {
  kind: 'technical-note';
  kindLabel: 'Technical note';
  archiveDate: string;
  yearLabel: string;
  method: string;
  observation: string;
  scope: string;
}

export interface PublicStudySummary extends PublicPublicationBase {
  kind: 'study-summary';
  kindLabel: 'Completed study summary';
  yearLabel: 'Complete';
  method: string[];
  observation: string;
  scope: string[];
  relatedStudy: {
    label: string;
    href: string;
  };
}

export type PublicPublication = PublicTechnicalNote | PublicStudySummary;

const PUBLIC_INFORMATION_LEVELS = new Set(['TL-0', 'TL-1', 'TL-2']);

function isPublicDiscipline(value: string): value is PublicPublicationDiscipline {
  return Object.hasOwn(PUBLICATION_CAPABILITIES, value);
}

function capabilityHref(discipline: PublicPublicationDiscipline): string {
  return `/research/${PUBLICATION_CAPABILITIES[discipline]}/`;
}

function formatArchiveDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function extractLabel(body: string, label: string): string | undefined {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(
    new RegExp(
      `\\*\\*${escapedLabel}:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\s*\\n\\*\\*[^*\\n]+:\\*\\*|$)`,
      'i',
    ),
  );

  return match?.[1]?.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim() || undefined;
}

function firstOpenLabel(
  record: SubmissionRecordData,
  sectionIds: readonly string[],
  labels: readonly string[],
): string | undefined {
  for (const sectionId of sectionIds) {
    const section = record.sections.find((candidate) => candidate.id === sectionId);
    if (!section || section.disclosure.mode !== 'open' || typeof section.body !== 'string') {
      continue;
    }

    for (const label of labels) {
      const value = extractLabel(section.body, label);
      if (value) return value;
    }
  }

  return undefined;
}

/**
 * Produce the only submission fields that may enter the public publication pages.
 * The route follows the released archive identifier, but the identifier is not
 * presented as document metadata or copied into the public body.
 */
export function projectReleasedSubmission(
  record: SubmissionRecordData,
): PublicTechnicalNote | null {
  if (
    record.publicationState !== 'released' ||
    record.recordFamily !== 'research' ||
    record.formId !== 'TL-101' ||
    !PUBLIC_INFORMATION_LEVELS.has(record.information.level) ||
    !isPublicDiscipline(record.controllingOffice) ||
    record.sections.some((section) => section.disclosure.mode !== 'open')
  ) {
    return null;
  }

  const method = firstOpenLabel(
    record,
    ['method-and-observations', 'procedure-results'],
    ['Method', 'Procedure / Method No.'],
  );
  const observation = firstOpenLabel(
    record,
    ['method-and-observations', 'procedure-results'],
    ['Observations', 'Observations / Technician Notes'],
  );
  const scope = firstOpenLabel(
    record,
    ['purpose-and-scope', 'purpose-scope'],
    ['Scope limitation', 'Normal Operating Assumptions'],
  );

  if (!method || !observation || !scope) return null;

  const discipline = record.controllingOffice;
  const slug = record.recordId.toLowerCase();

  return {
    kind: 'technical-note',
    kindLabel: 'Technical note',
    slug,
    href: `/publications/${slug}/`,
    title: record.title,
    summary: record.summary,
    discipline,
    capabilityHref: capabilityHref(discipline),
    archiveDate: record.effectiveDate,
    dateLabel: formatArchiveDate(record.effectiveDate),
    yearLabel: record.effectiveDate.slice(0, 4),
    sortKey: `1-${record.effectiveDate}`,
    method,
    observation,
    scope,
  };
}

export function projectCompletedStudy(study: StudyData): PublicStudySummary | null {
  if (
    study.status !== 'completed' ||
    study.editorialState !== 'owner-approved' ||
    !study.publicSummary ||
    !isPublicDiscipline(study.discipline)
  ) {
    return null;
  }

  const discipline = study.discipline;
  const slug = study.studyId.toLowerCase();

  return {
    kind: 'study-summary',
    kindLabel: 'Completed study summary',
    slug,
    href: `/publications/${slug}/`,
    title: study.title,
    summary: study.publicSummary,
    discipline,
    capabilityHref: capabilityHref(discipline),
    dateLabel: 'Protocol complete',
    yearLabel: 'Complete',
    sortKey: '2-completed-study',
    method: [...study.methodNotes],
    observation: study.publicSummary,
    scope: [...study.limitations],
    relatedStudy: {
      label: 'View the completed study protocol',
      href: `/studies/${study.slug}/`,
    },
  };
}

export function buildPublicPublicationLibrary(
  submissions: readonly SubmissionRecordData[],
  studies: readonly StudyData[],
): PublicPublication[] {
  return [...submissions.map(projectReleasedSubmission), ...studies.map(projectCompletedStudy)]
    .filter((publication): publication is PublicPublication => publication !== null)
    .sort((left, right) => right.sortKey.localeCompare(left.sortKey));
}
