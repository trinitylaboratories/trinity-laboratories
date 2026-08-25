export const CLASSIFICATION_LEVELS = [
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

export const ELEVATED_CLASSIFICATION_LEVELS = [
  'TL-3',
  'TL-4',
  'TL-5',
  'TL-6',
  'TL-7',
  'TL/Ø',
] as const;

export const PHYSICAL_ACCESS_LEVELS = [
  'S-0',
  'S-1',
  'S-2',
  'S-3',
  'S-4',
  'S-5',
  'S-6',
  'S-X',
] as const;

export const ENDORSEMENTS = [
  '/A',
  '/B',
  '/C',
  '/E',
  '/F',
  '/M',
  '/N',
  '/R',
  '/S',
  '/T',
  '/V',
  '/X',
] as const;

export const FACILITY_CONDITIONS = ['WHITE', 'BLUE', 'YELLOW', 'RED', 'BLACK', 'NULL'] as const;
export const PUBLICATION_STATES = ['released', 'controlled', 'withheld'] as const;
export const DISCLOSURE_MODES = ['open', 'authorize', 'withheld'] as const;
export const SUBMISSION_STATUSES = ['active', 'archived', 'superseded'] as const;
export const RECORD_FAMILIES = [
  'security',
  'research',
  'personnel',
  'operations',
  'notice',
  'procedure',
  'executive',
] as const;

export const FORM_TEMPLATE_IDS = [
  'TL-101',
  'TL-220',
  'TL-340',
  'TL-470',
  'TL-590',
  'TL-P110',
  'TL-P365',
  'TL-O205',
  'TL-N310',
  'TL-N480',
  'TL-SOP-720',
  'TL-SOP-760',
  'TL-SOP-890',
  'TL-X510',
  'TL-X595',
] as const;

export type ClassificationLevel = (typeof CLASSIFICATION_LEVELS)[number];
export type ElevatedClassificationLevel = (typeof ELEVATED_CLASSIFICATION_LEVELS)[number];
export type PhysicalAccessLevel = (typeof PHYSICAL_ACCESS_LEVELS)[number];
export type Endorsement = (typeof ENDORSEMENTS)[number];
export type FacilityCondition = (typeof FACILITY_CONDITIONS)[number];
export type PublicationState = (typeof PUBLICATION_STATES)[number];
export type DisclosureMode = (typeof DISCLOSURE_MODES)[number];
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
export type RecordFamily = (typeof RECORD_FAMILIES)[number];
export type FormTemplateId = (typeof FORM_TEMPLATE_IDS)[number];

export type DisclosureRule =
  | { mode: 'open' }
  | {
      mode: 'authorize';
      requiredLevel: ElevatedClassificationLevel;
      program?: string;
      compartment?: string;
    }
  | { mode: 'withheld' };

interface SubmissionSectionBase {
  id: string;
  title: string;
  summary?: string;
}

export type SubmissionSection =
  | (SubmissionSectionBase & { disclosure: { mode: 'open' }; body: string })
  | (SubmissionSectionBase & {
      disclosure: Extract<DisclosureRule, { mode: 'authorize' }>;
      body: string;
    })
  | (SubmissionSectionBase & {
      disclosure: { mode: 'withheld' };
      /** Compile-time guard: withheld plaintext cannot be represented. */
      body?: never;
    });

export interface SubmissionRecordData {
  recordId: string;
  formId: FormTemplateId;
  title: string;
  recordType: 'completed-report';
  recordFamily: RecordFamily;
  status: SubmissionStatus;
  revision: string;
  effectiveDate: string;
  controllingOffice: string;
  publicationState: PublicationState;
  information: {
    level: ClassificationLevel;
    program?: string;
    compartment?: string;
  };
  physicalAccess?: {
    level: PhysicalAccessLevel;
    endorsements: Endorsement[];
  };
  facilityCondition?: FacilityCondition;
  tags: string[];
  /** Public catalog copy. Never place controlled content in this field. */
  summary: string;
  relatedRecords: string[];
  sections: SubmissionSection[];
}

export function submissionHref(recordId: string): string {
  return `/records/reports/${recordId.toLowerCase()}/`;
}

export function publicationDisclosureMode(state: PublicationState): DisclosureMode {
  if (state === 'released') return 'open';
  if (state === 'controlled') return 'authorize';
  return 'withheld';
}
