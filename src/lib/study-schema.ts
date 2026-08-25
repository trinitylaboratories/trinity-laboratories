import { z } from 'astro/zod';

export const STUDY_STATUSES = [
  'recruiting',
  'interest-only',
  'active',
  'paused',
  'completed',
] as const;

export const STUDY_STATUS_LABELS = {
  recruiting: 'Participation open',
  'interest-only': 'Interest screening',
  active: 'Study in progress',
  paused: 'Enrollment paused',
  completed: 'Protocol complete',
} as const satisfies Record<(typeof STUDY_STATUSES)[number], string>;

export const STUDY_APPLICATION_MODES = ['eligibility-screen', 'interest-screen'] as const;

const shortText = z.string().trim().min(1).max(180);
const narrativeText = z.string().trim().min(1).max(800);
const fieldBase = {
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  label: z.string().trim().min(1).max(120),
  hint: z.string().trim().min(1).max(180).optional(),
  required: z.boolean().default(true),
};

export const studyApplicationFieldSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...fieldBase,
      type: z.literal('select'),
      options: z.array(z.string().trim().min(1).max(80)).min(2).max(12),
    })
    .strict(),
  z
    .object({
      ...fieldBase,
      type: z.literal('checkbox'),
    })
    .strict(),
  z
    .object({
      ...fieldBase,
      type: z.literal('number'),
      min: z.number().int().min(0).max(1_000),
      max: z.number().int().min(1).max(1_000),
      step: z.number().positive().max(100).default(1),
      unit: z.string().trim().min(1).max(30).optional(),
    })
    .strict(),
  z
    .object({
      ...fieldBase,
      type: z.literal('text'),
      maxLength: z.number().int().min(8).max(80),
      placeholder: z.string().trim().min(1).max(80).optional(),
    })
    .strict(),
]);

const protocolStepSchema = z
  .object({
    code: z.string().regex(/^\d{2}$/),
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(300),
  })
  .strict();

const applicationSchema = z
  .object({
    mode: z.enum(STUDY_APPLICATION_MODES),
    title: z.string().trim().min(1).max(100),
    introduction: z.string().trim().min(1).max(320),
    fields: z.array(studyApplicationFieldSchema).min(3).max(10),
  })
  .strict();

export const studySchema = z
  .object({
    studyId: z.string().regex(/^ST-\d{2}-\d{3}$/),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().trim().min(1).max(120),
    shortTitle: z.string().trim().min(1).max(72),
    researchQuestion: z.string().trim().min(20).max(280),
    summary: z.string().trim().min(40).max(500),
    status: z.enum(STUDY_STATUSES),
    phase: z.string().trim().min(1).max(60),
    discipline: z.string().trim().min(1).max(80),
    studyType: z.string().trim().min(1).max(80),
    participationMode: z.string().trim().min(1).max(80),
    commitment: z.string().trim().min(1).max(120),
    protocolRevision: z.string().regex(/^\d+\.\d+$/),
    controllingOffice: z.string().trim().min(1).max(100),
    displayOrder: z.number().int().min(1).max(100),
    ageMinimum: z.number().int().min(18).max(100),
    featured: z.boolean().default(false),
    eligibility: z.array(shortText).min(2).max(12),
    exclusions: z.array(shortText).min(1).max(12),
    participantActivities: z.array(narrativeText).min(2).max(12),
    protocolSteps: z.array(protocolStepSchema).min(3).max(6),
    dataRequested: z.array(shortText).min(2).max(12),
    dataNotRequested: z.array(shortText).min(2).max(12),
    samplePrompts: z.array(shortText).min(1).max(8),
    methodNotes: z.array(narrativeText).min(2).max(10),
    limitations: z.array(narrativeText).min(2).max(10),
    publicSummary: z.string().trim().min(40).max(500).optional(),
    application: applicationSchema.nullable(),
    relatedRecordIds: z
      .array(z.string().regex(/^TL-[A-Z0-9]+(?:-[A-Z0-9]+)*$/))
      .max(12)
      .default([]),
    editorialState: z.enum(['owner-approved', 'working-convention', 'proposal']),
  })
  .strict()
  .superRefine((study, context) => {
    const mayScreen = study.status === 'recruiting' || study.status === 'interest-only';
    if (mayScreen !== Boolean(study.application)) {
      context.addIssue({
        code: 'custom',
        message: mayScreen
          ? 'Recruiting and interest-only studies require an application screen.'
          : 'Only recruiting and interest-only studies may expose an application screen.',
        path: ['application'],
      });
    }

    if (study.application) {
      const fieldIds = new Set<string>();
      for (const [index, field] of study.application.fields.entries()) {
        if (fieldIds.has(field.id)) {
          context.addIssue({
            code: 'custom',
            message: `Duplicate application field ID: ${field.id}`,
            path: ['application', 'fields', index, 'id'],
          });
        }
        fieldIds.add(field.id);

        if (field.type === 'select' && new Set(field.options).size !== field.options.length) {
          context.addIssue({
            code: 'custom',
            message: `Application field ${field.id} contains duplicate options.`,
            path: ['application', 'fields', index, 'options'],
          });
        }
        if (field.type === 'number' && field.min >= field.max) {
          context.addIssue({
            code: 'custom',
            message: `Application field ${field.id} must have min below max.`,
            path: ['application', 'fields', index, 'min'],
          });
        }
      }
    }

    const stepCodes = study.protocolSteps.map(({ code }) => code);
    if (new Set(stepCodes).size !== stepCodes.length) {
      context.addIssue({
        code: 'custom',
        message: 'Protocol step codes must be unique.',
        path: ['protocolSteps'],
      });
    }
  });

export type StudyData = z.infer<typeof studySchema>;
export type StudyApplicationField = z.infer<typeof studyApplicationFieldSchema>;
export type StudyStatus = (typeof STUDY_STATUSES)[number];

export function studyStatusLabel(status: StudyStatus): string {
  return STUDY_STATUS_LABELS[status];
}
