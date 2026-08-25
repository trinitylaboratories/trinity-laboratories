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
};
