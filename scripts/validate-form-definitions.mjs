import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  parseFormTranscription,
  stableJson,
  validateDefinitionCatalog,
} from '../tools/record-desk/core.mjs';

const EXPECTED_TEMPLATE_IDS = Object.freeze([
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
]);

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CATALOG_PATH = path.join(PROJECT_ROOT, 'data', 'form-definitions', 'forms.json');

export async function loadDefinitionCatalog(catalogPath = CATALOG_PATH) {
  const text = await fs.readFile(catalogPath, 'utf8');
  const catalog = JSON.parse(text);
  validateDefinitionCatalog(catalog);
  return catalog;
}

export async function validateCommittedDefinitions({ root = PROJECT_ROOT } = {}) {
  const catalogPath = path.join(root, 'data', 'form-definitions', 'forms.json');
  const catalog = await loadDefinitionCatalog(catalogPath);
  const actualIds = catalog.templates.map((template) => template.templateId).sort();
  if (stableJson(actualIds) !== stableJson([...EXPECTED_TEMPLATE_IDS].sort())) {
    throw new Error(
      `Form catalog must contain exactly the 15 released templates; found: ${actualIds.join(', ')}.`,
    );
  }
  let sectionCount = 0;
  let fieldCount = 0;
  for (const definition of catalog.templates) {
    const sourcePath = path.join(root, ...definition.sourcePath.split('/'));
    const source = await fs.readFile(sourcePath, 'utf8');
    const extracted = parseFormTranscription(source, definition.sourcePath);
    if (stableJson(extracted) !== stableJson(definition)) {
      throw new Error(
        `${definition.templateId}: committed definition differs from ${definition.sourcePath}.`,
      );
    }
    sectionCount += definition.sections.length;
    fieldCount += definition.sections.reduce((total, section) => total + section.fields.length, 0);
  }
  return { templateCount: catalog.templates.length, sectionCount, fieldCount };
}

async function main() {
  if (process.argv.length !== 2)
    throw new Error('validate-form-definitions.mjs takes no arguments.');
  const result = await validateCommittedDefinitions();
  console.log(
    `Validated ${result.templateCount} form definitions, ${result.sectionCount} sections, and ${result.fieldCount} fields.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
