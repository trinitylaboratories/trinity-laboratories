import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

const CLASSIFICATION_LEVELS = new Set([
  'TL-0',
  'TL-1',
  'TL-2',
  'TL-3',
  'TL-4',
  'TL-5',
  'TL-6',
  'TL-7',
  'TL/Ø',
]);
const ELEVATED_LEVELS = new Set(['TL-3', 'TL-4', 'TL-5', 'TL-6', 'TL-7', 'TL/Ø']);
const PHYSICAL_LEVELS = new Set(['S-0', 'S-1', 'S-2', 'S-3', 'S-4', 'S-5', 'S-6', 'S-X']);
const ENDORSEMENTS = new Set([
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
]);
const FACILITY_CONDITIONS = new Set(['WHITE', 'BLUE', 'YELLOW', 'RED', 'BLACK', 'NULL']);
const FORM_IDS = new Set([
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
]);
const RECORD_FAMILIES = new Set([
  'security',
  'research',
  'personnel',
  'operations',
  'notice',
  'procedure',
  'executive',
]);
const STATUSES = new Set(['active', 'archived', 'superseded']);
const PUBLICATION_STATES = new Set(['released', 'controlled', 'withheld']);
const RECORD_ID_PATTERN = /^TL-[A-Z0-9]+(?:-[A-Z0-9]+)+$/;
const SECTION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EVIDENCE_PATH_PATTERN = /^\/portal\/media\/geospatial\/[a-z0-9][a-z0-9/_-]*\.webp$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PERSONNEL_ID_PATTERN = /^TL-P110-PER-(\d{4})$/;
const PERSONNEL_TITLE_PATTERN = /^Personnel Assignment Record — File (\d{4})$/;
const PERSONNEL_SUMMARY =
  'Personnel assignment file. Subject identity and assignment details require the displayed information eligibility.';
const PERSONNEL_TAGS = new Set(['personnel', 'assignment-record', 'active', 'archived', 'tl-p110']);
const SENSITIVE_PERSONNEL_LABELS = Object.freeze([
  ['birth information', /\b(?:date of birth|birth date|born on)\b/i],
  ['residential address', /\b(?:home|residential|street) address\b/i],
  ['personal email', /\b(?:personal e-?mail|e-?mail address)\b/i],
  ['telephone number', /\b(?:telephone|phone|mobile) (?:number|no\.?|contact)\b/i],
  ['emergency contact', /\b(?:emergency contact|next of kin)\b/i],
  [
    'government identifier',
    /\b(?:social security|government identifier|passport|driver'?s license)\b/i,
  ],
  [
    'access credential identifier',
    /\b(?:badge|credential|access card) (?:number|no\.?|id|identifier)\b/i,
  ],
  ['signature or portrait', /\b(?:signature|portrait|headshot)\b/i],
  ['health information', /\b(?:medical|health|diagnosis|treatment)\b/i],
  ['family information', /\b(?:family member|spouse|dependent)\b/i],
]);

const RECORD_KEYS = new Set([
  'recordId',
  'formId',
  'title',
  'recordType',
  'recordFamily',
  'status',
  'revision',
  'effectiveDate',
  'controllingOffice',
  'publicationState',
  'information',
  'physicalAccess',
  'facilityCondition',
  'tags',
  'summary',
  'relatedRecords',
  'sections',
  'evidence',
]);
const REQUIRED_RECORD_KEYS = [
  'recordId',
  'formId',
  'title',
  'recordType',
  'recordFamily',
  'status',
  'revision',
  'effectiveDate',
  'controllingOffice',
  'publicationState',
  'information',
  'tags',
  'summary',
  'relatedRecords',
  'sections',
];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function rejectUnknownKeys(value, allowed, location, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${location}.${key}: unknown property`);
  }
}

function requireKeys(value, required, location, errors) {
  for (const key of required) {
    if (!hasOwn(value, key)) errors.push(`${location}.${key}: required property is missing`);
  }
}

function requireString(value, location, errors, maximum = Number.POSITIVE_INFINITY) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${location}: expected a non-empty string`);
  } else if (value.length > maximum) {
    errors.push(`${location}: exceeds ${maximum} characters`);
  }
}

function requireEnum(value, allowed, location, errors) {
  if (!allowed.has(value)) errors.push(`${location}: unsupported value ${JSON.stringify(value)}`);
}

function validIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function validateInformation(value, errors) {
  if (!isObject(value)) {
    errors.push('record.information: expected an object');
    return;
  }
  rejectUnknownKeys(
    value,
    new Set(['level', 'program', 'compartment']),
    'record.information',
    errors,
  );
  requireKeys(value, ['level'], 'record.information', errors);
  requireEnum(value.level, CLASSIFICATION_LEVELS, 'record.information.level', errors);
  if (hasOwn(value, 'program')) {
    requireString(value.program, 'record.information.program', errors, 80);
  }
  if (hasOwn(value, 'compartment')) {
    requireString(value.compartment, 'record.information.compartment', errors, 80);
  }
}

function validatePhysicalAccess(value, errors) {
  if (!isObject(value)) {
    errors.push('record.physicalAccess: expected an object');
    return;
  }
  rejectUnknownKeys(value, new Set(['level', 'endorsements']), 'record.physicalAccess', errors);
  requireKeys(value, ['level', 'endorsements'], 'record.physicalAccess', errors);
  requireEnum(value.level, PHYSICAL_LEVELS, 'record.physicalAccess.level', errors);
  if (!Array.isArray(value.endorsements)) {
    errors.push('record.physicalAccess.endorsements: expected an array');
    return;
  }
  const seen = new Set();
  for (const [index, endorsement] of value.endorsements.entries()) {
    requireEnum(endorsement, ENDORSEMENTS, `record.physicalAccess.endorsements[${index}]`, errors);
    if (seen.has(endorsement)) {
      errors.push(`record.physicalAccess.endorsements[${index}]: duplicate endorsement`);
    }
    seen.add(endorsement);
  }
}

function validateDisclosure(value, index, errors) {
  const location = `record.sections[${index}].disclosure`;
  if (!isObject(value)) {
    errors.push(`${location}: expected an object`);
    return undefined;
  }
  const mode = value.mode;
  if (!['open', 'authorize', 'withheld'].includes(mode)) {
    errors.push(`${location}.mode: unsupported value ${JSON.stringify(mode)}`);
    return undefined;
  }
  const allowed =
    mode === 'authorize'
      ? new Set(['mode', 'requiredLevel', 'program', 'compartment'])
      : new Set(['mode']);
  rejectUnknownKeys(value, allowed, location, errors);
  requireKeys(value, ['mode'], location, errors);

  if (mode === 'authorize' && !hasOwn(value, 'requiredLevel')) {
    errors.push(`${location}.requiredLevel: required for authorize disclosure`);
  }
  if (hasOwn(value, 'requiredLevel')) {
    requireEnum(value.requiredLevel, ELEVATED_LEVELS, `${location}.requiredLevel`, errors);
  }
  if (hasOwn(value, 'program')) requireString(value.program, `${location}.program`, errors, 80);
  if (hasOwn(value, 'compartment')) {
    requireString(value.compartment, `${location}.compartment`, errors, 80);
  }
  return mode;
}

function validateSections(value, publicationState, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push('record.sections: expected at least one section');
    return;
  }
  const ids = new Set();
  for (const [index, section] of value.entries()) {
    const location = `record.sections[${index}]`;
    if (!isObject(section)) {
      errors.push(`${location}: expected an object`);
      continue;
    }
    const mode = isObject(section.disclosure) ? section.disclosure.mode : undefined;
    const allowedKeys =
      mode === 'withheld'
        ? new Set(['id', 'title', 'summary', 'disclosure'])
        : new Set(['id', 'title', 'summary', 'disclosure', 'body']);
    rejectUnknownKeys(section, allowedKeys, location, errors);
    requireKeys(
      section,
      mode === 'withheld' ? ['id', 'title', 'disclosure'] : ['id', 'title', 'disclosure', 'body'],
      location,
      errors,
    );
    requireString(section.id, `${location}.id`, errors, 80);
    if (typeof section.id === 'string' && !SECTION_ID_PATTERN.test(section.id)) {
      errors.push(`${location}.id: must be a lowercase kebab-case identifier`);
    }
    if (ids.has(section.id)) errors.push(`${location}.id: duplicate section identifier`);
    ids.add(section.id);
    requireString(section.title, `${location}.title`, errors, 180);
    if (hasOwn(section, 'summary'))
      requireString(section.summary, `${location}.summary`, errors, 240);
    const validatedMode = validateDisclosure(section.disclosure, index, errors);

    if (validatedMode === 'withheld') {
      if (hasOwn(section, 'body')) {
        errors.push(`${location}.body: withheld sections must not contain a body value`);
      }
    } else {
      requireString(section.body, `${location}.body`, errors, 50_000);
    }
    if (publicationState === 'withheld' && validatedMode !== 'withheld') {
      errors.push(
        `${location}.disclosure.mode: a withheld record may contain only withheld sections`,
      );
    }
  }
}

function validateEvidence(value, record, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push('record.evidence: expected between 1 and 8 evidence plates');
    return;
  }
  if (value.length > 8) errors.push('record.evidence: exceeds 8 evidence plates');
  if (record.publicationState !== 'controlled') {
    errors.push('record.evidence: evidence plates require a controlled publication state');
  }
  const rank = Number(String(record.information?.level ?? '').replace('TL-', ''));
  if (Number.isFinite(rank) && rank < 3) {
    errors.push('record.evidence: evidence plates require TL-3 or higher classification');
  }

  const seen = {
    id: new Set(),
    path: new Set(),
    sha256: new Set(),
  };
  for (const [index, plate] of value.entries()) {
    const location = `record.evidence[${index}]`;
    if (!isObject(plate)) {
      errors.push(`${location}: expected an object`);
      continue;
    }
    const mode = plate.mode;
    const keys =
      mode === 'withheld'
        ? new Set(['id', 'label', 'mode', 'summary'])
        : new Set([
            'id',
            'label',
            'mode',
            'path',
            'mediaType',
            'sourceFilename',
            'sha256',
            'width',
            'height',
            'alt',
            'caption',
            'credit',
          ]);
    rejectUnknownKeys(plate, keys, location, errors);
    requireKeys(plate, [...keys], location, errors);
    requireString(plate.id, `${location}.id`, errors, 80);
    if (typeof plate.id === 'string' && !SECTION_ID_PATTERN.test(plate.id)) {
      errors.push(`${location}.id: must be a lowercase kebab-case identifier`);
    }
    requireString(plate.label, `${location}.label`, errors, 120);
    if (!['available', 'withheld'].includes(mode)) {
      errors.push(`${location}.mode: expected "available" or "withheld"`);
    }

    if (mode === 'withheld') {
      requireString(plate.summary, `${location}.summary`, errors, 300);
      if (seen.id.has(plate.id)) errors.push(`${location}.id: duplicate evidence id`);
      seen.id.add(plate.id);
      continue;
    }

    requireString(plate.path, `${location}.path`, errors, 240);
    if (typeof plate.path === 'string' && !EVIDENCE_PATH_PATTERN.test(plate.path)) {
      errors.push(
        `${location}.path: expected a project-local WebP beneath /portal/media/geospatial/`,
      );
    }
    if (plate.mediaType !== 'image/webp') {
      errors.push(`${location}.mediaType: must be "image/webp"`);
    }
    requireString(plate.sourceFilename, `${location}.sourceFilename`, errors, 180);
    if (
      typeof plate.sourceFilename === 'string' &&
      (/[\\/:]/.test(plate.sourceFilename) || ['.', '..'].includes(plate.sourceFilename))
    ) {
      errors.push(`${location}.sourceFilename: expected a source basename, not a path`);
    }
    requireString(plate.sha256, `${location}.sha256`, errors, 64);
    if (typeof plate.sha256 === 'string' && !SHA256_PATTERN.test(plate.sha256)) {
      errors.push(`${location}.sha256: expected a lowercase SHA-256 value`);
    }
    for (const dimension of ['width', 'height']) {
      const dimensionValue = plate[dimension];
      if (!Number.isInteger(dimensionValue) || dimensionValue < 1 || dimensionValue > 12_000) {
        errors.push(`${location}.${dimension}: expected an integer from 1 through 12000`);
      }
    }
    requireString(plate.alt, `${location}.alt`, errors, 300);
    requireString(plate.caption, `${location}.caption`, errors, 500);
    requireString(plate.credit, `${location}.credit`, errors, 240);

    for (const key of ['id', 'path', 'sha256']) {
      if (seen[key].has(plate[key])) {
        errors.push(`${location}.${key}: duplicate evidence ${key}`);
      }
      seen[key].add(plate[key]);
    }
  }
}

function validatePersonnelRecord(record, errors) {
  if (record.recordFamily !== 'personnel') return;

  if (record.formId !== 'TL-P110') {
    errors.push('record.formId: personnel records must originate from TL-P110');
  }
  if (!['TL-3', 'TL-4'].includes(record.information?.level)) {
    errors.push('record.information.level: personnel records must be TL-3 or TL-4');
  }
  if (record.publicationState !== 'controlled') {
    errors.push('record.publicationState: personnel records must be controlled');
  }
  if (hasOwn(record, 'physicalAccess')) {
    errors.push('record.physicalAccess: personnel records must not publish physical-access data');
  }
  if (hasOwn(record, 'facilityCondition')) {
    errors.push('record.facilityCondition: personnel records must not publish facility conditions');
  }
  if (hasOwn(record, 'evidence')) {
    errors.push('record.evidence: personnel records must not publish evidence plates');
  }
  if (record.controllingOffice !== 'Personnel Office') {
    errors.push(
      'record.controllingOffice: personnel records must use the generic Personnel Office',
    );
  }
  if (record.summary !== PERSONNEL_SUMMARY) {
    errors.push('record.summary: personnel records must use the approved generic summary');
  }

  const idMatch =
    typeof record.recordId === 'string' ? record.recordId.match(PERSONNEL_ID_PATTERN) : null;
  const titleMatch =
    typeof record.title === 'string' ? record.title.match(PERSONNEL_TITLE_PATTERN) : null;
  if (!idMatch) {
    errors.push('record.recordId: personnel records must use TL-P110-PER-NNNN');
  }
  if (!titleMatch) {
    errors.push('record.title: personnel records must use the generic file-number title');
  } else if (idMatch && titleMatch[1] !== idMatch[1]) {
    errors.push('record.title: personnel file number must match record.recordId');
  }

  if (Array.isArray(record.tags)) {
    for (const [index, tag] of record.tags.entries()) {
      if (!PERSONNEL_TAGS.has(tag)) {
        errors.push(`record.tags[${index}]: personnel record tags must use the generic allowlist`);
      }
    }
    if (!record.tags.includes(record.status)) {
      errors.push('record.tags: personnel record tags must include the record status');
    }
  }

  const controlledText = Array.isArray(record.sections)
    ? record.sections
        .flatMap((section) => [section?.title, section?.summary, section?.body])
        .filter((value) => typeof value === 'string')
        .join('\n')
    : '';
  for (const [label, pattern] of SENSITIVE_PERSONNEL_LABELS) {
    if (pattern.test(controlledText)) {
      errors.push(`record.sections: personnel records must not contain ${label}`);
    }
  }
}

/**
 * Validate invariants that must also hold for workstation-generated records.
 * Information classification and physical access are intentionally evaluated as separate objects.
 */
export function validateSubmissionRecord(record, options = {}) {
  const errors = [];
  if (!isObject(record)) return ['record: expected a JSON object'];

  rejectUnknownKeys(record, RECORD_KEYS, 'record', errors);
  requireKeys(record, REQUIRED_RECORD_KEYS, 'record', errors);
  requireString(record.recordId, 'record.recordId', errors, 80);
  if (typeof record.recordId === 'string' && !RECORD_ID_PATTERN.test(record.recordId)) {
    errors.push('record.recordId: must use the canonical uppercase TL record format');
  }
  if (options.expectedRecordId && record.recordId !== options.expectedRecordId) {
    errors.push(`record.recordId: expected ${options.expectedRecordId} from the source filename`);
  }
  requireEnum(record.formId, FORM_IDS, 'record.formId', errors);
  requireString(record.title, 'record.title', errors, 180);
  if (record.recordType !== 'completed-report') {
    errors.push('record.recordType: must be "completed-report"');
  }
  requireEnum(record.recordFamily, RECORD_FAMILIES, 'record.recordFamily', errors);
  requireEnum(record.status, STATUSES, 'record.status', errors);
  requireString(record.revision, 'record.revision', errors, 80);
  if (!validIsoDate(record.effectiveDate)) {
    errors.push('record.effectiveDate: expected a real calendar date in YYYY-MM-DD form');
  }
  requireString(record.controllingOffice, 'record.controllingOffice', errors, 140);
  requireEnum(record.publicationState, PUBLICATION_STATES, 'record.publicationState', errors);
  validateInformation(record.information, errors);
  if (record.publicationState === 'released' && ELEVATED_LEVELS.has(record.information?.level)) {
    errors.push('record.publicationState: TL-3+ records may not be released');
  }
  if (hasOwn(record, 'physicalAccess')) validatePhysicalAccess(record.physicalAccess, errors);
  if (hasOwn(record, 'facilityCondition')) {
    requireEnum(record.facilityCondition, FACILITY_CONDITIONS, 'record.facilityCondition', errors);
  }

  if (!Array.isArray(record.tags) || record.tags.length === 0) {
    errors.push('record.tags: expected at least one public catalog tag');
  } else {
    if (record.tags.length > 20) errors.push('record.tags: exceeds 20 catalog tags');
    const tags = new Set();
    for (const [index, tag] of record.tags.entries()) {
      requireString(tag, `record.tags[${index}]`, errors, 80);
      if (tags.has(tag)) errors.push(`record.tags[${index}]: duplicate tag`);
      tags.add(tag);
    }
  }
  requireString(record.summary, 'record.summary', errors, 600);

  if (!Array.isArray(record.relatedRecords)) {
    errors.push('record.relatedRecords: expected an array');
  } else {
    if (record.relatedRecords.length > 30) {
      errors.push('record.relatedRecords: exceeds 30 related record identifiers');
    }
    const related = new Set();
    for (const [index, relatedId] of record.relatedRecords.entries()) {
      requireString(relatedId, `record.relatedRecords[${index}]`, errors, 80);
      if (relatedId === record.recordId) {
        errors.push(`record.relatedRecords[${index}]: a record cannot relate to itself`);
      }
      if (related.has(relatedId))
        errors.push(`record.relatedRecords[${index}]: duplicate record id`);
      related.add(relatedId);
      if (options.knownRecordIds && !options.knownRecordIds.has(relatedId)) {
        errors.push(`record.relatedRecords[${index}]: unknown record id ${relatedId}`);
      }
    }
    if (typeof record.formId === 'string' && !related.has(record.formId)) {
      errors.push('record.relatedRecords: must include the source formId');
    }
  }

  validateSections(record.sections, record.publicationState, errors);
  if (hasOwn(record, 'evidence')) validateEvidence(record.evidence, record, errors);
  validatePersonnelRecord(record, errors);
  return errors;
}

async function walk(directory, extensions) {
  const acceptedExtensions = Array.isArray(extensions) ? extensions : [extensions];
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(target, acceptedExtensions)));
    else if (
      entry.isFile() &&
      acceptedExtensions.some((extension) => entry.name.endsWith(extension))
    ) {
      output.push(target);
    }
  }
  return output.sort();
}

async function readCanonicalDocIds(root) {
  const directory = path.join(root, 'src', 'content', 'docs');
  const ids = new Set();
  for (const filename of await walk(directory, ['.md', '.mdx'])) {
    const source = await readFile(filename, 'utf8');
    const frontmatter = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
    if (!frontmatter) continue;
    const parsed = parseYaml(frontmatter[1]);
    if (isObject(parsed) && typeof parsed.recordId === 'string') ids.add(parsed.recordId);
  }
  return ids;
}

async function validateAvailableEvidenceAssets(root, records) {
  const references = records.flatMap(({ filename, record }) => {
    if (!Array.isArray(record?.evidence)) return [];
    return record.evidence.flatMap((plate, index) =>
      isObject(plate) &&
      plate.mode === 'available' &&
      typeof plate.path === 'string' &&
      EVIDENCE_PATH_PATTERN.test(plate.path) &&
      typeof plate.sha256 === 'string' &&
      SHA256_PATTERN.test(plate.sha256)
        ? [{ filename, index, plate }]
        : [],
    );
  });
  if (references.length === 0) return [];

  const diagnostics = [];
  const ledgerFilename = path.join(root, 'data', 'asset-ledger.json');
  let ledger;
  try {
    ledger = JSON.parse(await readFile(ledgerFilename, 'utf8'));
  } catch (error) {
    const detail = error?.code === 'ENOENT' ? 'file is missing' : 'file is not valid JSON';
    return [`data/asset-ledger.json: required for available evidence plates (${detail})`];
  }

  const ledgerAssets = Array.isArray(ledger?.assets) ? ledger.assets : [];
  const publicRoot = path.resolve(root, 'public');
  for (const { filename, index, plate } of references) {
    const relativeRecord = path.relative(root, filename);
    const location = `${relativeRecord}: record.evidence[${index}]`;
    const derivative = path.resolve(publicRoot, `.${plate.path}`);
    const relativeDerivative = path.relative(publicRoot, derivative);
    if (
      relativeDerivative.startsWith('..') ||
      path.isAbsolute(relativeDerivative) ||
      relativeDerivative.length === 0
    ) {
      diagnostics.push(`${location}.path: derivative resolves outside the public asset root`);
      continue;
    }

    let bytes;
    try {
      bytes = await readFile(derivative);
    } catch (error) {
      const detail = error?.code === 'ENOENT' ? 'is missing' : 'could not be read';
      diagnostics.push(`${location}.path: derivative ${detail}`);
      bytes = null;
    }
    if (bytes) {
      const actualHash = createHash('sha256').update(bytes).digest('hex');
      if (actualHash !== plate.sha256) {
        diagnostics.push(`${location}.sha256: does not match the public derivative bytes`);
      }
    }

    const matchingLedgerAsset = ledgerAssets.find(
      (asset) =>
        isObject(asset) &&
        isObject(asset.derivative) &&
        asset.derivative.path === plate.path &&
        asset.derivative.sha256 === plate.sha256,
    );
    if (!matchingLedgerAsset) {
      diagnostics.push(
        `${location}.path: no asset-ledger entry matches the evidence path and SHA-256`,
      );
    }
  }
  return diagnostics;
}

export async function validateSubmissionDirectory(root = process.cwd()) {
  const directory = path.join(root, 'src', 'content', 'submissions');
  const filenames = await walk(directory, '.json');
  const records = [];
  const diagnostics = [];

  for (const filename of filenames) {
    try {
      records.push({ filename, record: JSON.parse(await readFile(filename, 'utf8')) });
    } catch (error) {
      diagnostics.push(`${path.relative(root, filename)}: invalid JSON (${error.message})`);
    }
  }

  const docIds = await readCanonicalDocIds(root);
  const submissionIds = new Set();
  for (const { filename, record } of records) {
    if (typeof record.recordId === 'string') {
      if (submissionIds.has(record.recordId) || docIds.has(record.recordId)) {
        diagnostics.push(
          `${path.relative(root, filename)}: duplicate canonical record id ${record.recordId}`,
        );
      }
      submissionIds.add(record.recordId);
    }
  }
  const knownRecordIds = new Set([...docIds, ...submissionIds]);

  for (const { filename, record } of records) {
    const relative = path.relative(root, filename);
    const expectedRecordId = path.basename(filename, '.json').toUpperCase();
    for (const message of validateSubmissionRecord(record, { expectedRecordId, knownRecordIds })) {
      diagnostics.push(`${relative}: ${message}`);
    }
  }

  diagnostics.push(...(await validateAvailableEvidenceAssets(root, records)));

  return { diagnostics, files: filenames.length, records: records.length };
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const result = await validateSubmissionDirectory();
  if (result.diagnostics.length > 0) {
    console.error(result.diagnostics.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`Validated ${result.records} completed submission record(s).`);
  }
}
