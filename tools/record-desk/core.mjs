import path from 'node:path';

export const DRAFT_VERSION = 1;
export const FORM_DEFINITION_VERSION = 1;
export const MAX_DRAFT_BYTES = 1024 * 1024;
export const DISCLOSURE_MODES = Object.freeze(['open', 'authorize', 'withheld']);
export const INFORMATION_LEVELS = Object.freeze([
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
export const PHYSICAL_LEVELS = Object.freeze([
  'S-0',
  'S-1',
  'S-2',
  'S-3',
  'S-4',
  'S-5',
  'S-6',
  'S-X',
]);
export const ENDORSEMENTS = Object.freeze([
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
export const RECORD_FAMILIES = Object.freeze([
  'research',
  'personnel',
  'operations',
  'notice',
  'procedure',
  'executive',
]);
export const FACILITY_CONDITIONS = Object.freeze([
  'WHITE',
  'BLUE',
  'YELLOW',
  'RED',
  'BLACK',
  'NULL',
]);

const OWN = Object.prototype.hasOwnProperty;
const ISO_DATE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
export const RECORD_ID_PATTERN = /^TL-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
export const COMPLETED_RECORD_ID_PATTERN = /^TL-[A-Z0-9]+(?:-[A-Z0-9]+)+$/;
const SAFE_DRAFT_NAME = /^[a-z0-9][a-z0-9._-]{0,119}\.tirn-draft\.json$/;

export function slugify(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function assertString(value, label, { min = 1, max = 10_000 } = {}) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw new Error(`${label} must contain ${min}-${max} characters.`);
  }
  if (normalized.includes('\0')) throw new Error(`${label} contains a null byte.`);
  return normalized;
}

function assertOptionalString(value, label, max = 200) {
  if (value === undefined) return undefined;
  return assertString(value, label, { max });
}

function assertEnum(value, values, label) {
  if (!values.includes(value)) {
    throw new Error(`${label} must be one of: ${values.join(', ')}.`);
  }
  return value;
}

function assertStringArray(value, label, { maxItems = 30, itemMax = 100 } = {}) {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(`${label} must be an array with at most ${maxItems} entries.`);
  }
  const normalized = value.map((item, index) =>
    assertString(item, `${label}[${index}]`, { max: itemMax }),
  );
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} contains duplicate entries.`);
  }
  return normalized;
}

function isRealIsoDate(value) {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function parseFormTranscription(markdown, sourcePath) {
  const metadata = (pattern, label) => {
    const match = markdown.match(pattern);
    if (!match) throw new Error(`${sourcePath}: missing ${label}.`);
    return match[1];
  };
  const templateId = metadata(/^recordId: '([^']+)'/m, 'recordId');
  const fullTitle = metadata(/^title: '([^']+)'/m, 'title');
  const family = metadata(/^recordFamily: '([^']+)'/m, 'recordFamily');
  const informationLevel = metadata(/^information:\r?\n\s+level: '([^']+)'/m, 'information level');
  const legacyLevel = metadata(/^legacyMarking:\r?\n\s+level: '([^']+)'/m, 'legacy level');
  const legacyLabel = metadata(
    /^legacyMarking:\r?\n\s+level: '[^']+'\r?\n\s+label: '([^']+)'/m,
    'legacy label',
  );
  const title = fullTitle.replace(new RegExp(`^${templateId.replaceAll('-', '\\-')} — `), '');
  const body = markdown
    .split(/^---\s*$/m)
    .slice(2)
    .join('---');
  const sections = [];
  const sectionPattern = /^## (.+?)\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/gm;
  for (const match of body.matchAll(sectionPattern)) {
    const sectionTitle = match[1].trim();
    if (sectionTitle === 'Accessible transcription') continue;
    const chunk = match[2];
    const fields = [];
    for (const line of chunk.split(/\r?\n/)) {
      const row = line.match(/^\|\s*(.*?)\s*\|\s*(.*?)\s*\|$/);
      if (!row) continue;
      const label = row[1].trim();
      const response = row[2].trim();
      if (label === 'Field' || /^-+$/.test(label)) continue;
      const base = { id: slugify(label), label };
      if (response.includes('☐')) {
        const options = [...response.matchAll(/☐\s*([^<]+)/g)].map((option) => option[1].trim());
        fields.push({ ...base, kind: 'choice', options });
      } else if (response === '_Blank response_') {
        fields.push({ ...base, kind: 'text' });
      } else {
        fields.push({ ...base, kind: 'fixed', fixedValue: response });
      }
    }
    const nestedNarratives = [
      ...chunk.matchAll(
        /^### (.+?)\r?\n\r?\n_(\d+) blank lined response rows in the original form\._/gm,
      ),
    ];
    for (const narrative of nestedNarratives) {
      const label = narrative[1].trim();
      fields.push({ id: slugify(label), label, kind: 'longtext', rows: Number(narrative[2]) });
    }
    if (fields.length === 0) {
      const narrative = chunk.match(
        /^(?:\r?\n)*_(\d+) blank lined response rows in the original form\._/m,
      );
      if (narrative) {
        fields.push({
          id: slugify(sectionTitle),
          label: sectionTitle,
          kind: 'longtext',
          rows: Number(narrative[1]),
        });
      }
    }
    if (fields.length > 0) {
      sections.push({ id: slugify(sectionTitle), title: sectionTitle, fields });
    }
  }
  return {
    templateId,
    title,
    family,
    informationLevel,
    legacy: { level: legacyLevel, label: legacyLabel },
    sourcePath: sourcePath.replaceAll('\\', '/'),
    sections,
  };
}

export function validateFormDefinition(definition) {
  const value = assertObject(definition, 'Form definition');
  const templateId = assertString(value.templateId, 'templateId', { max: 30 });
  if (!RECORD_ID_PATTERN.test(templateId)) throw new Error(`${templateId}: invalid templateId.`);
  assertString(value.title, `${templateId}.title`, { max: 180 });
  assertEnum(value.family, RECORD_FAMILIES, `${templateId}.family`);
  assertEnum(value.informationLevel, INFORMATION_LEVELS, `${templateId}.informationLevel`);
  const legacy = assertObject(value.legacy, `${templateId}.legacy`);
  assertString(legacy.level, `${templateId}.legacy.level`, { max: 10 });
  assertString(legacy.label, `${templateId}.legacy.label`, { max: 80 });
  const sourcePath = assertString(value.sourcePath, `${templateId}.sourcePath`, { max: 240 });
  if (!/^src\/content\/docs\/records\/forms\/tl-[a-z0-9-]+\.md$/.test(sourcePath)) {
    throw new Error(`${templateId}: sourcePath must point to a released form transcription.`);
  }
  if (!Array.isArray(value.sections) || value.sections.length === 0) {
    throw new Error(`${templateId}: sections must be a non-empty array.`);
  }
  const sectionIds = new Set();
  for (const [sectionIndex, sectionValue] of value.sections.entries()) {
    const section = assertObject(sectionValue, `${templateId}.sections[${sectionIndex}]`);
    const sectionId = assertString(section.id, `${templateId}.sections[${sectionIndex}].id`, {
      max: 80,
    });
    if (slugify(sectionId) !== sectionId || sectionIds.has(sectionId)) {
      throw new Error(`${templateId}: invalid or duplicate section id ${sectionId}.`);
    }
    sectionIds.add(sectionId);
    assertString(section.title, `${templateId}.${sectionId}.title`, { max: 180 });
    if (!Array.isArray(section.fields) || section.fields.length === 0) {
      throw new Error(`${templateId}.${sectionId}: fields must be a non-empty array.`);
    }
    const fieldIds = new Set();
    for (const [fieldIndex, fieldValue] of section.fields.entries()) {
      const field = assertObject(fieldValue, `${templateId}.${sectionId}.fields[${fieldIndex}]`);
      const fieldId = assertString(
        field.id,
        `${templateId}.${sectionId}.fields[${fieldIndex}].id`,
        {
          max: 80,
        },
      );
      if (slugify(fieldId) !== fieldId || fieldIds.has(fieldId)) {
        throw new Error(`${templateId}.${sectionId}: invalid or duplicate field id ${fieldId}.`);
      }
      fieldIds.add(fieldId);
      assertString(field.label, `${templateId}.${sectionId}.${fieldId}.label`, { max: 180 });
      assertEnum(
        field.kind,
        ['text', 'longtext', 'choice', 'fixed'],
        `${templateId}.${sectionId}.${fieldId}.kind`,
      );
      if (field.kind === 'choice') {
        const options = assertStringArray(
          field.options,
          `${templateId}.${sectionId}.${fieldId}.options`,
          { maxItems: 12, itemMax: 100 },
        );
        if (options.length < 2)
          throw new Error(`${templateId}.${sectionId}.${fieldId}: choice needs options.`);
      }
      if (
        field.kind === 'longtext' &&
        (!Number.isInteger(field.rows) || field.rows < 2 || field.rows > 20)
      ) {
        throw new Error(`${templateId}.${sectionId}.${fieldId}: invalid row count.`);
      }
      if (field.kind === 'fixed') {
        assertString(field.fixedValue, `${templateId}.${sectionId}.${fieldId}.fixedValue`, {
          max: 500,
        });
      }
    }
  }
  return true;
}

export function validateDefinitionCatalog(catalog) {
  const value = assertObject(catalog, 'Form definition catalog');
  if (value.schemaVersion !== FORM_DEFINITION_VERSION) {
    throw new Error(`Unsupported form definition schema version: ${String(value.schemaVersion)}.`);
  }
  if (!Array.isArray(value.templates) || value.templates.length === 0) {
    throw new Error('Form definition catalog must include templates.');
  }
  const ids = new Set();
  for (const definition of value.templates) {
    validateFormDefinition(definition);
    if (ids.has(definition.templateId))
      throw new Error(`Duplicate templateId: ${definition.templateId}.`);
    ids.add(definition.templateId);
  }
  return true;
}

function normalizeDisclosure(value, label, { forPublication }) {
  const disclosure = assertObject(value, label);
  const mode = assertEnum(disclosure.mode, DISCLOSURE_MODES, `${label}.mode`);
  const normalized = { mode };
  if (mode === 'authorize') {
    normalized.requiredLevel = assertEnum(
      disclosure.requiredLevel,
      INFORMATION_LEVELS.slice(3),
      `${label}.requiredLevel`,
    );
    const program = assertOptionalString(disclosure.program, `${label}.program`, 80);
    const compartment = assertOptionalString(disclosure.compartment, `${label}.compartment`, 80);
    if (program) normalized.program = program;
    if (compartment) normalized.compartment = compartment;
  } else if (
    OWN.call(disclosure, 'requiredLevel') ||
    OWN.call(disclosure, 'program') ||
    OWN.call(disclosure, 'compartment')
  ) {
    throw new Error(`${label}: only authorize disclosures may carry access requirements.`);
  }
  if (forPublication && mode === 'authorize' && !normalized.requiredLevel) {
    throw new Error(`${label}: authorized content requires an information level.`);
  }
  return normalized;
}

export function validateDraftPackage(input, { forPublication = false } = {}) {
  const draft = assertObject(input, 'Draft package');
  if (draft.draftVersion !== DRAFT_VERSION) {
    throw new Error(`Unsupported draft version: ${String(draft.draftVersion)}.`);
  }
  const templateId = assertString(draft.templateId, 'templateId', { max: 30 });
  if (!RECORD_ID_PATTERN.test(templateId)) throw new Error('templateId is malformed.');
  if (
    draft.updatedAt !== undefined &&
    (typeof draft.updatedAt !== 'string' || Number.isNaN(Date.parse(draft.updatedAt)))
  ) {
    throw new Error('updatedAt must be an ISO-compatible timestamp.');
  }
  const record = assertObject(draft.record, 'record');
  const recordId = assertString(record.recordId, 'record.recordId', { max: 60 });
  if (!COMPLETED_RECORD_ID_PATTERN.test(recordId)) {
    throw new Error('record.recordId must identify a completed record, not a source form.');
  }
  if (assertString(record.formId, 'record.formId', { max: 30 }) !== templateId) {
    throw new Error('record.formId must match templateId.');
  }
  assertString(record.title, 'record.title', { max: 180, min: forPublication ? 3 : 0 });
  if (record.recordType !== 'completed-report') {
    throw new Error('record.recordType must be completed-report.');
  }
  assertEnum(record.recordFamily, RECORD_FAMILIES, 'record.recordFamily');
  assertEnum(record.status, ['active', 'archived', 'superseded'], 'record.status');
  assertString(record.revision, 'record.revision', { max: 80, min: forPublication ? 1 : 0 });
  if (typeof record.effectiveDate !== 'string' || !isRealIsoDate(record.effectiveDate)) {
    throw new Error('record.effectiveDate must be a real YYYY-MM-DD date.');
  }
  assertString(record.controllingOffice, 'record.controllingOffice', {
    max: 140,
    min: forPublication ? 2 : 0,
  });
  assertEnum(
    record.publicationState,
    ['released', 'controlled', 'withheld'],
    'record.publicationState',
  );
  const information = assertObject(record.information, 'record.information');
  assertEnum(information.level, INFORMATION_LEVELS, 'record.information.level');
  assertOptionalString(information.program, 'record.information.program', 80);
  assertOptionalString(information.compartment, 'record.information.compartment', 80);
  if (record.physicalAccess !== undefined) {
    const physical = assertObject(record.physicalAccess, 'record.physicalAccess');
    assertEnum(physical.level, PHYSICAL_LEVELS, 'record.physicalAccess.level');
    const endorsements = assertStringArray(
      physical.endorsements ?? [],
      'record.physicalAccess.endorsements',
      {
        maxItems: ENDORSEMENTS.length,
        itemMax: 2,
      },
    );
    for (const endorsement of endorsements) {
      assertEnum(endorsement, ENDORSEMENTS, 'record.physicalAccess.endorsement');
    }
  }
  if (record.facilityCondition !== undefined) {
    assertEnum(record.facilityCondition, FACILITY_CONDITIONS, 'record.facilityCondition');
  }
  const tags = assertStringArray(record.tags, 'record.tags', { maxItems: 20, itemMax: 60 });
  if (forPublication && tags.length === 0)
    throw new Error('record.tags requires at least one tag.');
  assertString(record.summary, 'record.summary', { max: 600, min: forPublication ? 20 : 0 });
  const relatedRecords = assertStringArray(record.relatedRecords, 'record.relatedRecords', {
    maxItems: 30,
    itemMax: 60,
  });
  if (forPublication && !relatedRecords.includes(templateId)) {
    throw new Error('record.relatedRecords must include the originating formId.');
  }
  for (const relatedId of relatedRecords) {
    if (!RECORD_ID_PATTERN.test(relatedId)) {
      throw new Error(`record.relatedRecords contains malformed record id ${relatedId}.`);
    }
    if (relatedId === recordId) throw new Error('A record cannot relate to itself.');
  }
  if (!Array.isArray(record.sections) || record.sections.length === 0) {
    throw new Error('record.sections must be a non-empty array.');
  }
  const sectionIds = new Set();
  const sectionModes = new Map();
  for (const [index, sectionValue] of record.sections.entries()) {
    const section = assertObject(sectionValue, `record.sections[${index}]`);
    const id = assertString(section.id, `record.sections[${index}].id`, { max: 80 });
    if (slugify(id) !== id || sectionIds.has(id))
      throw new Error(`Invalid or duplicate section id: ${id}.`);
    sectionIds.add(id);
    assertString(section.title, `record.sections[${index}].title`, { max: 180 });
    const disclosure = normalizeDisclosure(
      section.disclosure,
      `record.sections[${index}].disclosure`,
      {
        forPublication,
      },
    );
    sectionModes.set(id, disclosure.mode);
    if (disclosure.mode === 'withheld') {
      if (OWN.call(section, 'body'))
        throw new Error(`Withheld section ${id} must not contain body text.`);
    } else {
      assertString(section.body, `record.sections[${index}].body`, {
        max: 50_000,
        min: forPublication ? 1 : 0,
      });
    }
  }
  if (
    forPublication &&
    record.publicationState === 'withheld' &&
    [...sectionModes.values()].some((mode) => mode !== 'withheld')
  ) {
    throw new Error('A withheld record must withhold every section.');
  }
  if (draft.workstation !== undefined) {
    const workstation = assertObject(draft.workstation, 'workstation');
    const fieldValues = assertObject(workstation.fieldValues, 'workstation.fieldValues');
    for (const [sectionId, rawFields] of Object.entries(fieldValues)) {
      if (!sectionIds.has(sectionId))
        throw new Error(`workstation contains unknown section ${sectionId}.`);
      const fields = assertObject(rawFields, `workstation.fieldValues.${sectionId}`);
      const entries = Object.entries(fields);
      if (entries.length > 100)
        throw new Error(`workstation section ${sectionId} contains too many fields.`);
      for (const [fieldId, value] of entries) {
        if (slugify(fieldId) !== fieldId)
          throw new Error(`workstation field id ${fieldId} is invalid.`);
        if (typeof value !== 'string' || value.length > 10_000 || value.includes('\0')) {
          throw new Error(`workstation field ${sectionId}.${fieldId} is invalid.`);
        }
        if (sectionModes.get(sectionId) === 'withheld' && value.trim()) {
          throw new Error(
            `Withheld section ${sectionId} must not retain workstation field values.`,
          );
        }
      }
    }
  }
  const checklist = assertObject(draft.safetyChecklist, 'safetyChecklist');
  for (const key of [
    'rightsConfirmed',
    'noRealSecrets',
    'personalDataReviewed',
    'withheldContentRemoved',
  ]) {
    if (typeof checklist[key] !== 'boolean')
      throw new Error(`safetyChecklist.${key} must be boolean.`);
    if (forPublication && checklist[key] !== true) {
      throw new Error(`safetyChecklist.${key} must be confirmed before import.`);
    }
  }
  return true;
}

export function assertRecordMatchesDefinition(draft, definition) {
  if (draft.templateId !== definition.templateId) {
    throw new Error('Draft template does not match the selected definition.');
  }
  const expected = new Map(definition.sections.map((section) => [section.id, section.title]));
  if (draft.record.sections.length !== expected.size) {
    throw new Error('Draft must include every template section exactly once.');
  }
  for (const section of draft.record.sections) {
    if (expected.get(section.id) !== section.title) {
      throw new Error(`Section ${section.id} does not match the form definition.`);
    }
    expected.delete(section.id);
  }
  if (expected.size > 0) throw new Error('Draft omits one or more template sections.');
  return true;
}

export function toPublicRecord(draft) {
  validateDraftPackage(draft, { forPublication: true });
  const record = draft.record;
  /** @type {{ level: string, program?: string, compartment?: string }} */
  const information = { level: record.information.level };
  if (record.information.program) information.program = record.information.program.trim();
  if (record.information.compartment)
    information.compartment = record.information.compartment.trim();
  /**
   * @type {Array<{
   *   id: string,
   *   title: string,
   *   disclosure: {
   *     mode: 'open' | 'authorize' | 'withheld',
   *     requiredLevel?: string,
   *     program?: string,
   *     compartment?: string
   *   },
   *   body?: string
   * }>}
   */
  const sections = record.sections.map((section) => {
    /**
     * @type {{
     *   mode: 'open' | 'authorize' | 'withheld',
     *   requiredLevel?: string,
     *   program?: string,
     *   compartment?: string
     * }}
     */
    const disclosure = { mode: section.disclosure.mode };
    if (section.disclosure.mode === 'authorize') {
      disclosure.requiredLevel = section.disclosure.requiredLevel;
      if (section.disclosure.program) disclosure.program = section.disclosure.program.trim();
      if (section.disclosure.compartment)
        disclosure.compartment = section.disclosure.compartment.trim();
    }
    /** @type {{ id: string, title: string, disclosure: typeof disclosure, body?: string }} */
    const output = { id: section.id, title: section.title.trim(), disclosure };
    if (section.disclosure.mode !== 'withheld') output.body = section.body.trim();
    return output;
  });
  /**
   * @type {{
   *   recordId: string,
   *   formId: string,
   *   title: string,
   *   recordType: 'completed-report',
   *   recordFamily: string,
   *   status: string,
   *   revision: string,
   *   effectiveDate: string,
   *   controllingOffice: string,
   *   publicationState: string,
   *   information: typeof information,
   *   physicalAccess?: { level: string, endorsements: string[] },
   *   facilityCondition?: string,
   *   tags: string[],
   *   summary: string,
   *   relatedRecords: string[],
   *   sections: typeof sections
   * }}
   */
  const publicRecord = {
    recordId: record.recordId.trim(),
    formId: record.formId.trim(),
    title: record.title.trim(),
    recordType: 'completed-report',
    recordFamily: record.recordFamily,
    status: record.status,
    revision: record.revision.trim(),
    effectiveDate: record.effectiveDate,
    controllingOffice: record.controllingOffice.trim(),
    publicationState: record.publicationState,
    information,
    tags: [...record.tags],
    summary: record.summary.trim(),
    relatedRecords: [...record.relatedRecords],
    sections,
  };
  if (record.physicalAccess) {
    publicRecord.physicalAccess = {
      level: record.physicalAccess.level,
      endorsements: [...record.physicalAccess.endorsements],
    };
  }
  if (record.facilityCondition) publicRecord.facilityCondition = record.facilityCondition.trim();
  return publicRecord;
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function isSafeDraftFilename(value) {
  return typeof value === 'string' && SAFE_DRAFT_NAME.test(value) && !value.includes('..');
}

export function assertPathInside(root, candidate, label = 'Path') {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)))
    return resolvedCandidate;
  throw new Error(`${label} must remain inside the project root.`);
}

export function expectedOrigin(port) {
  return `http://127.0.0.1:${port}`;
}

export function requestAuthorityIsValid(headers, port, { requireOrigin = false } = {}) {
  const origin = expectedOrigin(port);
  const expectedHost = `127.0.0.1:${port}`;
  const host = Array.isArray(headers.host) ? headers.host[0] : headers.host;
  if (host !== expectedHost) return false;
  const requestOrigin = Array.isArray(headers.origin) ? headers.origin[0] : headers.origin;
  if (requireOrigin) return requestOrigin === origin;
  return requestOrigin === undefined || requestOrigin === origin;
}

export function parsePortArgument(argv, fallback = 4319) {
  if (argv.length === 0) return fallback;
  if (argv.length !== 2 || argv[0] !== '--port')
    throw new Error('Usage: record-desk-server.mjs [--port 1024-65535]');
  const port = Number(argv[1]);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error('Port must be an integer from 1024 through 65535.');
  }
  return port;
}
