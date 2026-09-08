import type { StudyData } from './study-schema';
import { studyStatusLabel } from './study-schema';
import type { SubmissionRecordData } from './submission-schema';

const INFORMATION_LEVEL_ORDER = [
  'TL-0',
  'TL-1',
  'TL-2',
  'TL-3',
  'TL-4',
  'TL-5',
  'TL-6',
  'TL-7',
  'TL/Ø',
] as const;

export interface ResearchStudyRegistryEntry {
  studyId: string;
  slug: string;
  shortTitle: string;
  discipline: string;
  status: StudyData['status'];
  statusLabel: string;
  phase: string;
  protocolRevision: string;
  controllingOffice: string;
  publicIntakeLabel: string;
  relatedRecordIds: string[];
  displayOrder: number;
}

export function researchStudyRegistryEntry(study: StudyData): ResearchStudyRegistryEntry {
  const publicIntakeLabel = study.application
    ? study.application.mode === 'eligibility-screen'
      ? 'Eligibility screen open'
      : 'Interest screen open'
    : 'No current public intake';

  return {
    studyId: study.studyId,
    slug: study.slug,
    shortTitle: study.shortTitle,
    discipline: study.discipline,
    status: study.status,
    statusLabel: studyStatusLabel(study.status),
    phase: study.phase,
    protocolRevision: study.protocolRevision,
    controllingOffice: study.controllingOffice,
    publicIntakeLabel,
    relatedRecordIds: [...study.relatedRecordIds],
    displayOrder: study.displayOrder,
  };
}

export function sortResearchStudyRegistry(
  entries: readonly ResearchStudyRegistryEntry[],
): ResearchStudyRegistryEntry[] {
  return [...entries].sort(
    (left, right) =>
      left.displayOrder - right.displayOrder || left.studyId.localeCompare(right.studyId),
  );
}

export function selectResearchReports(
  submissions: readonly SubmissionRecordData[],
): SubmissionRecordData[] {
  return submissions
    .filter(({ recordFamily }) => recordFamily === 'research')
    .sort(
      (left, right) =>
        right.effectiveDate.localeCompare(left.effectiveDate) ||
        left.recordId.localeCompare(right.recordId),
    );
}

export function sortResearchReportsByInformationLevel(
  submissions: readonly SubmissionRecordData[],
): SubmissionRecordData[] {
  const order = new Map(INFORMATION_LEVEL_ORDER.map((level, index) => [level, index]));

  return [...submissions].sort(
    (left, right) =>
      (order.get(left.information.level) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(right.information.level) ?? Number.MAX_SAFE_INTEGER) ||
      left.effectiveDate.localeCompare(right.effectiveDate) ||
      left.recordId.localeCompare(right.recordId),
  );
}

export function relatedReportsForStudy(
  entry: Pick<ResearchStudyRegistryEntry, 'relatedRecordIds'>,
  submissions: readonly SubmissionRecordData[],
): SubmissionRecordData[] {
  const byId = new Map(submissions.map((submission) => [submission.recordId, submission]));
  return entry.relatedRecordIds.flatMap((recordId) => {
    const submission = byId.get(recordId);
    return submission ? [submission] : [];
  });
}
