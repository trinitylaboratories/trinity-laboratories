import { defineCollection, z } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

const classificationLevels = [
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
const physicalLevels = ['S-0', 'S-1', 'S-2', 'S-3', 'S-4', 'S-5', 'S-6', 'S-X'] as const;
const endorsements = [
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
const facilityConditions = ['WHITE', 'BLUE', 'YELLOW', 'RED', 'BLACK', 'NULL'] as const;

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
        effectiveDate: z.string().date().optional(),
        controllingOffice: z.string().min(1).optional(),
        legacyMarking: z
          .object({
            level: z.enum(['I', 'II', 'III', 'IV', 'V']),
            label: z.string().min(1),
          })
          .optional(),
        information: z
          .object({
            level: z.enum(classificationLevels),
            program: z.string().min(1).optional(),
            compartment: z.string().min(1).optional(),
          })
          .optional(),
        physicalAccess: z
          .object({
            level: z.enum(physicalLevels),
            endorsements: z.array(z.enum(endorsements)).default([]),
          })
          .optional(),
        facilityCondition: z.enum(facilityConditions).optional(),
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
};
