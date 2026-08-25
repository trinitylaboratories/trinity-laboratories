import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseFormTranscription,
  stableJson,
  validateDefinitionCatalog,
  validateFormDefinition,
} from '../../tools/record-desk/core.mjs';
import {
  CATALOG_PATH,
  PROJECT_ROOT,
  loadDefinitionCatalog,
  validateCommittedDefinitions,
} from '../../scripts/validate-form-definitions.mjs';

const EXPECTED_IDS = [
  'TL-101',
  'TL-220',
  'TL-340',
  'TL-470',
  'TL-590',
  'TL-N310',
  'TL-N480',
  'TL-O205',
  'TL-P110',
  'TL-P365',
  'TL-SOP-720',
  'TL-SOP-760',
  'TL-SOP-890',
  'TL-X510',
  'TL-X595',
];

describe('record desk form definitions', () => {
  it('commits exactly the 15 released templates and all transcribed fields', async () => {
    const catalog = await loadDefinitionCatalog();
    expect(validateDefinitionCatalog(catalog)).toBe(true);
    expect(
      catalog.templates.map((template: { templateId: string }) => template.templateId),
    ).toEqual(EXPECTED_IDS);
    expect(
      catalog.templates.reduce(
        (total: number, template: { sections: unknown[] }) => total + template.sections.length,
        0,
      ),
    ).toBe(88);
    expect(
      catalog.templates.reduce(
        (total: number, template: { sections: Array<{ fields: unknown[] }> }) =>
          total + template.sections.reduce((count, section) => count + section.fields.length, 0),
        0,
      ),
    ).toBe(452);
  });

  it('matches each committed definition byte-for-structure with its released transcription', async () => {
    const catalog = await loadDefinitionCatalog(CATALOG_PATH);
    for (const definition of catalog.templates) {
      const source = await fs.readFile(path.join(PROJECT_ROOT, definition.sourcePath), 'utf8');
      expect(stableJson(parseFormTranscription(source, definition.sourcePath))).toBe(
        stableJson(definition),
      );
    }
    await expect(validateCommittedDefinitions()).resolves.toEqual({
      templateCount: 15,
      sectionCount: 88,
      fieldCount: 452,
    });
  });

  it('retains checkbox choices and normalizes legacy Levels I-V without conflating access', async () => {
    const catalog = await loadDefinitionCatalog();
    const levelMap = new Map([
      ['I', 'TL-1'],
      ['II', 'TL-2'],
      ['III', 'TL-3'],
      ['IV', 'TL-4'],
      ['V', 'TL-5'],
    ]);
    for (const definition of catalog.templates) {
      expect(definition.informationLevel).toBe(levelMap.get(definition.legacy.level));
      expect(definition).not.toHaveProperty('physicalAccess');
    }
    const tl340 = catalog.templates.find(
      (template: { templateId: string }) => template.templateId === 'TL-340',
    );
    const credibility = tl340.sections[0].fields.find(
      (field: { id: string }) => field.id === 'initial-credibility',
    );
    expect(credibility).toMatchObject({
      kind: 'choice',
      options: ['Unverified', 'Probable', 'Confirmed'],
    });
  });

  it('rejects duplicate section and field identifiers', async () => {
    const catalog = await loadDefinitionCatalog();
    const duplicateSection = structuredClone(catalog.templates[0]);
    duplicateSection.sections.push(structuredClone(duplicateSection.sections[0]));
    expect(() => validateFormDefinition(duplicateSection)).toThrow(/duplicate section id/i);

    const duplicateField = structuredClone(catalog.templates[0]);
    duplicateField.sections[0].fields.push(structuredClone(duplicateField.sections[0].fields[0]));
    expect(() => validateFormDefinition(duplicateField)).toThrow(/duplicate field id/i);
  });
});
