import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

import {
  CLASSIFICATION_LEVELS,
  DISCLOSURE_MODES,
  ENDORSEMENTS,
  ELEVATED_CLASSIFICATION_LEVELS,
  FACILITY_CONDITIONS,
  FORM_TEMPLATE_IDS,
  PHYSICAL_ACCESS_LEVELS,
  PUBLICATION_STATES,
  RECORD_FAMILIES,
  SUBMISSION_STATUSES,
} from './lib/submission-schema';
import { studySchema } from './lib/study-schema';

const elevatedDisclosureSchema = z
  .object({
    mode: z.literal(DISCLOSURE_MODES[1]),
    requiredLevel: z.enum(ELEVATED_CLASSIFICATION_LEVELS),
    program: z.string().trim().min(1).max(80).optional(),
    compartment: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

const submissionSectionSchema = z.union([
  z
    .object({
      id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      title: z.string().trim().min(1).max(180),
      summary: z.string().trim().min(1).max(240).optional(),
      disclosure: z.object({ mode: z.literal(DISCLOSURE_MODES[0]) }).strict(),
      body: z.string().trim().min(1).max(50_000),
    })
    .strict(),
  z
    .object({
      id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      title: z.string().trim().min(1).max(180),
      summary: z.string().trim().min(1).max(240).optional(),
      disclosure: elevatedDisclosureSchema,
      body: z.string().trim().min(1).max(50_000),
    })
    .strict(),
  z
    .object({
      id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      title: z.string().trim().min(1).max(180),
      summary: z.string().trim().min(1).max(240).optional(),
      disclosure: z.object({ mode: z.literal(DISCLOSURE_MODES[2]) }).strict(),
    })
    .strict(),
]);

const availableSubmissionEvidencePlateSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    label: z.string().trim().min(1).max(120),
    mode: z.literal('available'),
    path: z.string().regex(/^\/portal\/media\/geospatial\/[a-z0-9][a-z0-9/_-]*\.webp$/),
    mediaType: z.literal('image/webp'),
    sourceFilename: z
      .string()
      .trim()
      .min(1)
      .max(180)
      .refine(
        (value) => !/[\\/:]/.test(value) && !['.', '..'].includes(value),
        'Expected a source basename, not a path.',
      ),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    width: z.number().int().min(1).max(12_000),
    height: z.number().int().min(1).max(12_000),
    alt: z.string().trim().min(1).max(300),
    caption: z.string().trim().min(1).max(500),
    credit: z.string().trim().min(1).max(240),
  })
  .strict();

const withheldSubmissionEvidencePlateSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    label: z.string().trim().min(1).max(120),
    mode: z.literal('withheld'),
    summary: z.string().trim().min(1).max(300),
  })
  .strict();

const submissionEvidencePlateSchema = z.discriminatedUnion('mode', [
  availableSubmissionEvidencePlateSchema,
  withheldSubmissionEvidencePlateSchema,
]);

const submissionSchema = z
  .object({
    recordId: z.string().regex(/^TL-[A-Z0-9]+(?:-[A-Z0-9]+)+$/),
    formId: z.enum(FORM_TEMPLATE_IDS),
    title: z.string().trim().min(1).max(180),
    recordType: z.literal('completed-report'),
    recordFamily: z.enum(RECORD_FAMILIES),
    status: z.enum(SUBMISSION_STATUSES),
    revision: z.string().trim().min(1).max(80),
    effectiveDate: z.iso.date(),
    controllingOffice: z.string().trim().min(1).max(140),
    publicationState: z.enum(PUBLICATION_STATES),
    information: z
      .object({
        level: z.enum(CLASSIFICATION_LEVELS),
        program: z.string().trim().min(1).max(80).optional(),
        compartment: z.string().trim().min(1).max(80).optional(),
      })
      .strict(),
    physicalAccess: z
      .object({
        level: z.enum(PHYSICAL_ACCESS_LEVELS),
        endorsements: z.array(z.enum(ENDORSEMENTS)).default([]),
      })
      .strict()
      .optional(),
    facilityCondition: z.enum(FACILITY_CONDITIONS).optional(),
    tags: z.array(z.string().trim().min(1).max(60)).min(1).max(20),
    summary: z.string().trim().min(1).max(600),
    relatedRecords: z
      .array(z.string().regex(/^TL-[A-Z0-9]+(?:-[A-Z0-9]+)*$/))
      .max(30)
      .default([]),
    sections: z.array(submissionSectionSchema).min(1),
    evidence: z.array(submissionEvidencePlateSchema).min(1).max(8).optional(),
  })
  .strict()
  .superRefine((record, context) => {
    for (const [field, values] of [
      ['tags', record.tags],
      ['relatedRecords', record.relatedRecords],
    ] as const) {
      const seen = new Set<string>();
      for (const [index, value] of values.entries()) {
        if (seen.has(value)) {
          context.addIssue({
            code: 'custom',
            message: `Duplicate ${field === 'tags' ? 'tag' : 'related record'}: ${value}`,
            path: [field, index],
          });
        }
        seen.add(value);
      }
    }

    if (!record.relatedRecords.includes(record.formId)) {
      context.addIssue({
        code: 'custom',
        message: 'relatedRecords must include the source formId.',
        path: ['relatedRecords'],
      });
    }

    const sectionIds = new Set<string>();
    for (const [index, section] of record.sections.entries()) {
      if (sectionIds.has(section.id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate section id: ${section.id}`,
          path: ['sections', index, 'id'],
        });
      }
      sectionIds.add(section.id);
    }

    if (record.evidence) {
      if (record.publicationState !== 'controlled') {
        context.addIssue({
          code: 'custom',
          message: 'Evidence plates require a controlled publication state.',
          path: ['evidence'],
        });
      }

      const rank = Number(record.information.level.replace('TL-', ''));
      if (Number.isFinite(rank) && rank < 3) {
        context.addIssue({
          code: 'custom',
          message: 'Evidence plates require TL-3 or higher information classification.',
          path: ['evidence'],
        });
      }

      const ids = new Set<string>();
      const paths = new Set<string>();
      const hashes = new Set<string>();
      for (const [index, plate] of record.evidence.entries()) {
        if (ids.has(plate.id)) {
          context.addIssue({
            code: 'custom',
            message: `Duplicate evidence id: ${plate.id}`,
            path: ['evidence', index, 'id'],
          });
        }
        ids.add(plate.id);

        if (plate.mode === 'available') {
          for (const [key, value, seen] of [
            ['path', plate.path, paths],
            ['sha256', plate.sha256, hashes],
          ] as const) {
            if (seen.has(value)) {
              context.addIssue({
                code: 'custom',
                message: `Duplicate evidence ${key}: ${value}`,
                path: ['evidence', index, key],
              });
            }
            seen.add(value);
          }
        }
      }
    }

    if (record.publicationState === 'withheld') {
      for (const [index, section] of record.sections.entries()) {
        if (section.disclosure.mode !== 'withheld') {
          context.addIssue({
            code: 'custom',
            message: 'A withheld record may contain only withheld section descriptors.',
            path: ['sections', index, 'disclosure', 'mode'],
          });
        }
      }
    }
  });

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        recordId: z.string().min(1).optional(),
        recordType: z.enum(['policy', 'form-template', 'security-reference']).optional(),
        recordFamily: z
          .enum([
            'security',
            'research',
            'personnel',
            'operations',
            'notice',
            'procedure',
            'executive',
          ])
          .optional(),
        status: z.enum(['active', 'template', 'archived', 'superseded']).optional(),
        publicationState: z.enum(PUBLICATION_STATES).optional(),
        revision: z.string().min(1).optional(),
        effectiveDate: z.iso.date().optional(),
        controllingOffice: z.string().min(1).optional(),
        legacyMarking: z
          .object({
            level: z.enum(['I', 'II', 'III', 'IV', 'V']),
            label: z.string().min(1),
          })
          .optional(),
        information: z
          .object({
            level: z.enum(CLASSIFICATION_LEVELS),
            program: z.string().min(1).optional(),
            compartment: z.string().min(1).optional(),
          })
          .optional(),
        physicalAccess: z
          .object({
            level: z.enum(PHYSICAL_ACCESS_LEVELS),
            endorsements: z.array(z.enum(ENDORSEMENTS)).default([]),
          })
          .optional(),
        facilityCondition: z.enum(FACILITY_CONDITIONS).optional(),
        tags: z.array(z.string().min(1)).default([]),
        relatedRecords: z.array(z.string().min(1)).default([]),
        attachments: z
          .array(
            z.object({
              label: z.string().min(1),
              path: z.string().startsWith('/'),
              mediaType: z.string().min(1),
              sourceFilename: z.string().min(1),
              sha256: z.string().regex(/^[a-f0-9]{64}$/),
            }),
          )
          .default([]),
      }),
    }),
  }),
  submissions: defineCollection({
    loader: glob({
      base: './src/content/submissions',
      pattern: '**/*.json',
    }),
    schema: submissionSchema,
  }),
  studies: defineCollection({
    loader: glob({
      base: './src/content/studies',
      pattern: '**/*.json',
    }),
    schema: studySchema,
  }),
};
