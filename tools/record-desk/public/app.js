/* global Blob, CSS, document, fetch, Headers, HTMLSelectElement, requestAnimationFrame, TextEncoder, URL, window */

const MAX_DRAFT_BYTES = 1024 * 1024;
const INFORMATION_LEVELS = ['TL-0', 'TL-1', 'TL-2', 'TL-3', 'TL-4', 'TL-5', 'TL-6', 'TL-7', 'TL/Ø'];
const ENDORSEMENTS = ['/A', '/B', '/C', '/E', '/F', '/M', '/N', '/R', '/S', '/T', '/V', '/X'];
const csrfToken = document.querySelector('meta[name="tirn-csrf-token"]')?.content ?? '';

const elements = {
  templateSelect: document.querySelector('#template-select'),
  templateMeta: document.querySelector('#template-meta'),
  newFiling: document.querySelector('#new-filing'),
  draftSelect: document.querySelector('#draft-select'),
  loadDraft: document.querySelector('#load-draft'),
  refreshDrafts: document.querySelector('#refresh-drafts'),
  importFile: document.querySelector('#import-file'),
  workspaceTitle: document.querySelector('#workspace-title'),
  status: document.querySelector('#status-line'),
  form: document.querySelector('#filing-form'),
  sections: document.querySelector('#form-sections'),
  saveDraft: document.querySelector('#save-draft'),
  exportDraft: document.querySelector('#export-draft'),
  preview: document.querySelector('#preview-output'),
  previewModes: [...document.querySelectorAll('[data-preview-mode]')],
  recordId: document.querySelector('#record-id'),
  title: document.querySelector('#record-title'),
  revision: document.querySelector('#revision'),
  effectiveDate: document.querySelector('#effective-date'),
  controllingOffice: document.querySelector('#controlling-office'),
  publicationState: document.querySelector('#publication-state'),
  informationLevel: document.querySelector('#information-level'),
  program: document.querySelector('#program'),
  compartment: document.querySelector('#compartment'),
  physicalLevel: document.querySelector('#physical-level'),
  endorsementOptions: document.querySelector('#endorsement-options'),
  facilityCondition: document.querySelector('#facility-condition'),
  summary: document.querySelector('#summary'),
  tags: document.querySelector('#tags'),
  relatedRecords: document.querySelector('#related-records'),
  checks: {
    rightsConfirmed: document.querySelector('#check-rights'),
    noRealSecrets: document.querySelector('#check-secrets'),
    personalDataReviewed: document.querySelector('#check-personal'),
    withheldContentRemoved: document.querySelector('#check-withheld'),
  },
};

let catalog = null;
let currentTemplate = null;
let previewMode = 'guest';
let previewFrame = null;

function createElement(tag, options = {}, text = '') {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(options)) {
    if (key === 'className') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'hidden') node.hidden = value;
    else node.setAttribute(key, value);
  }
  if (text) node.textContent = text;
  return node;
}

function setStatus(message, state = '') {
  elements.status.textContent = message;
  if (state) elements.status.dataset.state = state;
  else delete elements.status.dataset.state;
}

async function apiRequest(pathname, options = {}) {
  const headers = new Headers(options.headers ?? {});
  headers.set('X-TIRN-CSRF', csrfToken);
  const response = await fetch(pathname, {
    ...options,
    headers,
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
  });
  const payload = await response.json().catch(() => ({ error: 'Malformed workstation response.' }));
  if (!response.ok) throw new Error(payload.error ?? 'Workstation request rejected.');
  return payload;
}

function csvValues(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, all) => all.indexOf(item) === index);
}

function localDate() {
  const date = new Date();
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function defaultAuthorizationLevel(templateLevel) {
  const index = INFORMATION_LEVELS.indexOf(templateLevel);
  return INFORMATION_LEVELS[Math.max(3, index)];
}

function fieldControlId(sectionId, fieldId) {
  return `response-${sectionId}-${fieldId}`;
}

function sectionControl(sectionId, selector) {
  return elements.sections.querySelector(`[data-section-id="${sectionId}"] ${selector}`);
}

function renderTemplateOptions() {
  elements.templateSelect.replaceChildren();
  for (const template of catalog.templates) {
    const option = createElement('option', { value: template.templateId });
    option.textContent = `${template.templateId} — ${template.title}`;
    elements.templateSelect.append(option);
  }
}

function renderStaticOptions() {
  elements.informationLevel.replaceChildren();
  for (const level of INFORMATION_LEVELS) {
    elements.informationLevel.append(createElement('option', { value: level }, level));
  }
  elements.endorsementOptions.replaceChildren();
  for (const endorsement of ENDORSEMENTS) {
    const label = createElement('label');
    const checkbox = createElement('input', {
      type: 'checkbox',
      value: endorsement,
      'data-endorsement': endorsement,
    });
    label.append(checkbox, document.createTextNode(endorsement));
    elements.endorsementOptions.append(label);
  }
}

function renderField(section, field) {
  const id = fieldControlId(section.id, field.id);
  if (field.kind === 'fixed') {
    const block = createElement('div', {
      className: 'fixed-field',
      dataset: { fieldId: field.id, fieldKind: field.kind },
    });
    block.append(
      createElement('strong', {}, field.label),
      createElement('span', {}, field.fixedValue),
    );
    return block;
  }
  const label = createElement('label', { for: id });
  label.append(document.createTextNode(field.label));
  let control;
  if (field.kind === 'choice') {
    control = createElement('select', {
      id,
      dataset: { fieldId: field.id, fieldKind: field.kind },
    });
    control.append(createElement('option', { value: '' }, 'Not entered'));
    for (const option of field.options)
      control.append(createElement('option', { value: option }, option));
  } else if (field.kind === 'longtext') {
    control = createElement('textarea', {
      id,
      rows: String(Math.min(field.rows, 8)),
      maxlength: '10000',
      dataset: { fieldId: field.id, fieldKind: field.kind },
    });
  } else {
    control = createElement('input', {
      id,
      type: 'text',
      maxlength: '1000',
      dataset: { fieldId: field.id, fieldKind: field.kind },
    });
  }
  label.append(control);
  return label;
}

function renderSection(section, index) {
  const wrapper = createElement('section', {
    className: 'document-section',
    dataset: { sectionId: section.id, disclosure: 'open' },
  });
  const heading = createElement('header', { className: 'section-heading' });
  const headingText = createElement('div');
  const titleId = `section-${section.id}`;
  const title = createElement('h2', { id: titleId }, section.title);
  headingText.append(title, createElement('p', {}, `${section.fields.length} response fields`));
  heading.append(
    createElement('span', { className: 'section-number' }, String(index + 1).padStart(2, '0')),
    headingText,
  );
  wrapper.setAttribute('aria-labelledby', titleId);

  const disclosureBar = createElement('div', { className: 'disclosure-control' });
  const disclosureLabel = createElement('label');
  disclosureLabel.append(document.createTextNode('Disclosure treatment'));
  const disclosure = createElement('select', {
    'data-disclosure-mode': section.id,
    'aria-label': `${section.title} disclosure treatment`,
  });
  disclosure.append(
    createElement('option', { value: 'open' }, 'Open — visible to guest'),
    createElement('option', { value: 'authorize' }, 'Authorize — restricted reveal'),
    createElement('option', { value: 'withheld' }, 'Withhold — metadata only'),
  );
  disclosureLabel.append(disclosure);

  const requirements = createElement('div', {
    className: 'authorization-requirements',
    dataset: { authorizationRequirements: section.id },
    hidden: true,
  });
  const levelLabel = createElement('label');
  levelLabel.append(document.createTextNode('Required level'));
  const levelSelect = createElement('select', {
    'data-required-level': section.id,
    'aria-label': `${section.title} required information level`,
  });
  for (const level of INFORMATION_LEVELS.slice(3)) {
    levelSelect.append(createElement('option', { value: level }, level));
  }
  levelSelect.value = defaultAuthorizationLevel(currentTemplate.informationLevel);
  levelLabel.append(levelSelect);
  const programLabel = createElement('label');
  programLabel.append(document.createTextNode('Program'));
  programLabel.append(
    createElement('input', {
      type: 'text',
      maxlength: '80',
      'data-required-program': section.id,
      'aria-label': `${section.title} required program`,
    }),
  );
  const compartmentLabel = createElement('label');
  compartmentLabel.append(document.createTextNode('Compartment'));
  compartmentLabel.append(
    createElement('input', {
      type: 'text',
      maxlength: '80',
      'data-required-compartment': section.id,
      'aria-label': `${section.title} required compartment`,
    }),
  );
  requirements.append(levelLabel, programLabel, compartmentLabel);
  disclosureBar.append(disclosureLabel, requirements);

  const fields = createElement('div', { className: 'field-grid', dataset: { fields: section.id } });
  for (const field of section.fields) fields.append(renderField(section, field));
  wrapper.append(heading, disclosureBar, fields);
  return wrapper;
}

function resetMetadata() {
  elements.recordId.value = `${currentTemplate.templateId}-DRAFT-001`;
  elements.title.value = '';
  elements.revision.value = '1.0';
  elements.effectiveDate.value = localDate();
  elements.controllingOffice.value = '';
  elements.publicationState.value = 'released';
  elements.informationLevel.value = currentTemplate.informationLevel;
  elements.program.value = '';
  elements.compartment.value = '';
  elements.physicalLevel.value = '';
  elements.facilityCondition.value = 'WHITE';
  elements.summary.value = '';
  elements.tags.value = currentTemplate.family;
  elements.relatedRecords.value = currentTemplate.templateId;
  for (const checkbox of elements.endorsementOptions.querySelectorAll('input'))
    checkbox.checked = false;
  for (const checkbox of Object.values(elements.checks)) checkbox.checked = false;
}

function selectTemplate(templateId, { reset = true } = {}) {
  const template = catalog.templates.find((entry) => entry.templateId === templateId);
  if (!template) throw new Error('Selected form template is not available.');
  currentTemplate = template;
  elements.templateSelect.value = template.templateId;
  elements.workspaceTitle.textContent = `${template.templateId} / ${template.title}`;
  const fieldCount = template.sections.reduce((total, section) => total + section.fields.length, 0);
  elements.templateMeta.textContent = `${template.family.toUpperCase()} · ${template.informationLevel} · ${template.sections.length} sections · ${fieldCount} fields`;
  elements.sections.replaceChildren();
  template.sections.forEach((section, index) =>
    elements.sections.append(renderSection(section, index)),
  );
  if (reset) resetMetadata();
  schedulePreview();
}

function getSectionFieldValues(section) {
  const values = {};
  for (const field of section.fields) {
    if (field.kind === 'fixed') continue;
    const control = document.querySelector(`#${CSS.escape(fieldControlId(section.id, field.id))}`);
    values[field.id] = control?.value ?? '';
  }
  return values;
}

function sectionBody(section, values) {
  const lines = [];
  for (const field of section.fields) {
    const value = field.kind === 'fixed' ? field.fixedValue : (values[field.id] ?? '').trim();
    if (!value) continue;
    lines.push(`**${field.label}:** ${value}`);
  }
  return lines.join('\n\n');
}

function readDisclosure(section) {
  const mode = sectionControl(section.id, '[data-disclosure-mode]')?.value ?? 'open';
  const disclosure = { mode };
  if (mode === 'authorize') {
    disclosure.requiredLevel = sectionControl(section.id, '[data-required-level]')?.value ?? 'TL-3';
    const program = sectionControl(section.id, '[data-required-program]')?.value.trim();
    const compartment = sectionControl(section.id, '[data-required-compartment]')?.value.trim();
    if (program) disclosure.program = program;
    if (compartment) disclosure.compartment = compartment;
  }
  return disclosure;
}

function buildDraftPackage() {
  if (!currentTemplate) throw new Error('No form template is selected.');
  const recordId = elements.recordId.value.trim().toUpperCase();
  if (!/^TL-[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(recordId)) {
    throw new Error(
      'Record ID must extend the form ID with an uppercase, hyphen-separated filing number.',
    );
  }
  const sections = [];
  const fieldValues = {};
  for (const section of currentTemplate.sections) {
    const disclosure = readDisclosure(section);
    const values = disclosure.mode === 'withheld' ? {} : getSectionFieldValues(section);
    fieldValues[section.id] = values;
    const output = { id: section.id, title: section.title, disclosure };
    if (disclosure.mode !== 'withheld') output.body = sectionBody(section, values);
    sections.push(output);
  }
  const information = { level: elements.informationLevel.value };
  if (elements.program.value.trim()) information.program = elements.program.value.trim();
  if (elements.compartment.value.trim())
    information.compartment = elements.compartment.value.trim();
  const record = {
    recordId,
    formId: currentTemplate.templateId,
    title: elements.title.value.trim(),
    recordType: 'completed-report',
    recordFamily: currentTemplate.family,
    status: 'active',
    revision: elements.revision.value.trim(),
    effectiveDate: elements.effectiveDate.value,
    controllingOffice: elements.controllingOffice.value.trim(),
    publicationState: elements.publicationState.value,
    information,
  };
  if (elements.physicalLevel.value) {
    record.physicalAccess = {
      level: elements.physicalLevel.value,
      endorsements: [...elements.endorsementOptions.querySelectorAll('input:checked')].map(
        (input) => input.value,
      ),
    };
  }
  if (elements.facilityCondition.value.trim()) {
    record.facilityCondition = elements.facilityCondition.value.trim();
  }
  record.tags = csvValues(elements.tags.value);
  record.summary = elements.summary.value.trim();
  record.relatedRecords = csvValues(elements.relatedRecords.value).map((value) =>
    value.toUpperCase(),
  );
  record.sections = sections;
  return {
    draftVersion: 1,
    templateId: currentTemplate.templateId,
    updatedAt: new Date().toISOString(),
    record,
    workstation: { fieldValues },
    safetyChecklist: Object.fromEntries(
      Object.entries(elements.checks).map(([key, checkbox]) => [key, checkbox.checked]),
    ),
  };
}

function setControlValue(element, value) {
  if (element && typeof value === 'string') element.value = value;
}

function applyDraftPackage(draft) {
  if (!draft || draft.draftVersion !== 1 || typeof draft.templateId !== 'string' || !draft.record) {
    throw new Error('This is not a supported TIRN draft package.');
  }
  selectTemplate(draft.templateId);
  const { record } = draft;
  setControlValue(elements.recordId, record.recordId);
  setControlValue(elements.title, record.title);
  setControlValue(elements.revision, record.revision);
  setControlValue(elements.effectiveDate, record.effectiveDate);
  setControlValue(elements.controllingOffice, record.controllingOffice);
  setControlValue(elements.publicationState, record.publicationState);
  setControlValue(elements.informationLevel, record.information?.level);
  setControlValue(elements.program, record.information?.program ?? '');
  setControlValue(elements.compartment, record.information?.compartment ?? '');
  setControlValue(elements.physicalLevel, record.physicalAccess?.level ?? '');
  setControlValue(elements.facilityCondition, record.facilityCondition ?? '');
  setControlValue(elements.summary, record.summary);
  setControlValue(elements.tags, Array.isArray(record.tags) ? record.tags.join(', ') : '');
  setControlValue(
    elements.relatedRecords,
    Array.isArray(record.relatedRecords) ? record.relatedRecords.join(', ') : '',
  );
  const endorsements = new Set(record.physicalAccess?.endorsements ?? []);
  for (const checkbox of elements.endorsementOptions.querySelectorAll('input')) {
    checkbox.checked = endorsements.has(checkbox.value);
  }
  const recordsById = new Map((record.sections ?? []).map((section) => [section.id, section]));
  const storedFields = draft.workstation?.fieldValues ?? {};
  for (const section of currentTemplate.sections) {
    const savedSection = recordsById.get(section.id);
    if (!savedSection) continue;
    const disclosureControl = sectionControl(section.id, '[data-disclosure-mode]');
    disclosureControl.value = savedSection.disclosure?.mode ?? 'open';
    sectionControl(section.id, '[data-required-level]').value =
      savedSection.disclosure?.requiredLevel ??
      defaultAuthorizationLevel(currentTemplate.informationLevel);
    sectionControl(section.id, '[data-required-program]').value =
      savedSection.disclosure?.program ?? '';
    sectionControl(section.id, '[data-required-compartment]').value =
      savedSection.disclosure?.compartment ?? '';
    updateDisclosureState(section.id, { clearWithheld: false });
    const values =
      savedSection.disclosure?.mode === 'withheld' ? {} : (storedFields[section.id] ?? {});
    for (const field of section.fields) {
      if (field.kind === 'fixed') continue;
      const control = document.querySelector(
        `#${CSS.escape(fieldControlId(section.id, field.id))}`,
      );
      setControlValue(control, values[field.id] ?? '');
    }
  }
  for (const [key, checkbox] of Object.entries(elements.checks)) {
    checkbox.checked = draft.safetyChecklist?.[key] === true;
  }
  schedulePreview();
}

function updateDisclosureState(sectionId, { clearWithheld = true } = {}) {
  const wrapper = elements.sections.querySelector(`[data-section-id="${sectionId}"]`);
  const mode = sectionControl(sectionId, '[data-disclosure-mode]')?.value ?? 'open';
  const requirements = sectionControl(sectionId, '[data-authorization-requirements]');
  const fields = sectionControl(sectionId, '[data-fields]');
  wrapper.dataset.disclosure = mode;
  requirements.hidden = mode !== 'authorize';
  for (const control of fields.querySelectorAll('input, select, textarea')) {
    if (mode === 'withheld' && clearWithheld) control.value = '';
    control.disabled = mode === 'withheld';
  }
  if (mode === 'withheld' && clearWithheld) {
    setStatus('Withheld section response text was cleared from the local draft.', 'success');
  }
  schedulePreview();
}

function previewFieldList(section) {
  const list = createElement('dl', { className: 'preview-field-list' });
  const values = getSectionFieldValues(section);
  for (const field of section.fields) {
    const value = field.kind === 'fixed' ? field.fixedValue : values[field.id]?.trim() || '—';
    list.append(createElement('dt', {}, field.label), createElement('dd', {}, value));
  }
  return list;
}

function redactionPanel(disclosure) {
  const panel = createElement('div', { className: 'redaction-panel' });
  if (disclosure.mode === 'withheld') {
    panel.append(
      createElement('strong', {}, 'CONTENT WITHHELD FROM PUBLICATION PACKAGE'),
      createElement('span', {}, 'Source text is not present in this draft section.'),
    );
    return panel;
  }
  const requirements = [disclosure.requiredLevel];
  if (disclosure.program) requirements.push(`PROGRAM ${disclosure.program}`);
  if (disclosure.compartment) requirements.push(`COMPARTMENT ${disclosure.compartment}`);
  panel.append(
    createElement('strong', {}, 'RESTRICTED CONTENT — AUTHORIZATION REQUIRED'),
    createElement('span', {}, requirements.filter(Boolean).join(' · ')),
  );
  return panel;
}

function renderPreview() {
  previewFrame = null;
  if (!currentTemplate) return;
  const output = createElement('article');
  const classification = createElement('div', { className: 'preview-classification' });
  classification.append(
    createElement('span', {}, elements.informationLevel.value || currentTemplate.informationLevel),
    createElement('span', {}, elements.recordId.value.trim() || 'UNASSIGNED RECORD'),
    createElement('span', {}, previewMode.toUpperCase()),
  );
  output.append(
    classification,
    createElement('h3', {}, elements.title.value.trim() || 'Untitled completed report'),
    createElement(
      'p',
      { className: 'preview-summary' },
      elements.summary.value.trim() || 'No summary entered.',
    ),
  );
  for (const section of currentTemplate.sections) {
    const disclosure = readDisclosure(section);
    const block = createElement('section', { className: 'preview-record-section' });
    block.append(createElement('h4', {}, section.title));
    if (disclosure.mode === 'open') block.append(previewFieldList(section));
    else if (disclosure.mode === 'authorize' && previewMode !== 'guest') {
      block.append(previewFieldList(section));
    } else block.append(redactionPanel(disclosure));
    output.append(block);
  }
  elements.preview.replaceChildren(output);
  elements.preview.style.animation = 'none';
  requestAnimationFrame(() => {
    elements.preview.style.animation = '';
  });
}

function schedulePreview() {
  if (previewFrame !== null) return;
  previewFrame = requestAnimationFrame(renderPreview);
}

function assertReadyForExport(draft) {
  if (draft.record.title.length < 3) throw new Error('Enter a record title before export.');
  if (!draft.record.revision) throw new Error('Enter a revision before export.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.record.effectiveDate)) {
    throw new Error('Enter an effective date before export.');
  }
  if (draft.record.controllingOffice.length < 2) {
    throw new Error('Enter a controlling office before export.');
  }
  if (draft.record.summary.length < 20) {
    throw new Error('Enter a public-safe summary of at least 20 characters before export.');
  }
  for (const section of draft.record.sections) {
    if (section.disclosure.mode !== 'withheld' && !section.body) {
      throw new Error('Complete or withhold every empty section before export.');
    }
  }
  if (!Object.values(draft.safetyChecklist).every(Boolean)) {
    throw new Error('Complete all four public-safety confirmations before export.');
  }
  if (
    draft.record.publicationState === 'withheld' &&
    draft.record.sections.some((section) => section.disclosure.mode !== 'withheld')
  ) {
    throw new Error('A metadata-only withheld record must withhold every section.');
  }
}

async function refreshDraftList({ announce = true } = {}) {
  const selected = elements.draftSelect.value;
  const payload = await apiRequest('/api/drafts');
  elements.draftSelect.replaceChildren(
    createElement(
      'option',
      { value: '' },
      payload.drafts.length ? 'Select a saved draft' : 'No local drafts saved',
    ),
  );
  for (const filename of payload.drafts) {
    elements.draftSelect.append(createElement('option', { value: filename }, filename));
  }
  if (payload.drafts.includes(selected)) elements.draftSelect.value = selected;
  if (announce) setStatus('Local draft list refreshed.', 'success');
}

async function saveDraft() {
  try {
    const draft = buildDraftPackage();
    const filename = `${draft.record.recordId.toLowerCase()}.tirn-draft.json`;
    await apiRequest(`/api/drafts/${encodeURIComponent(filename)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(draft),
    });
    await refreshDraftList({ announce: false });
    elements.draftSelect.value = filename;
    setStatus('Draft saved locally. No publication or network delivery occurred.', 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Draft could not be saved.', 'error');
  }
}

function exportDraft() {
  try {
    const draft = buildDraftPackage();
    assertReadyForExport(draft);
    const body = `${JSON.stringify(draft, null, 2)}\n`;
    if (new TextEncoder().encode(body).length > MAX_DRAFT_BYTES) {
      throw new Error('Draft exceeds the 1 MiB package limit.');
    }
    const blob = new Blob([body], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = createElement('a', {
      href: url,
      download: `${draft.record.recordId.toLowerCase()}.tirn-draft.json`,
    });
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setStatus(
      'Reviewed package exported. Run the repository importer from a working branch.',
      'success',
    );
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Draft could not be exported.', 'error');
  }
}

async function importDraftFile(file) {
  if (!file) return;
  if (file.size > MAX_DRAFT_BYTES || !file.name.endsWith('.tirn-draft.json')) {
    throw new Error('Choose a .tirn-draft.json package no larger than 1 MiB.');
  }
  let draft;
  try {
    draft = JSON.parse(await file.text());
  } catch {
    throw new Error('The selected package is not valid JSON.');
  }
  applyDraftPackage(draft);
  setStatus('Draft package loaded in memory. It has not been saved or published.', 'success');
}

async function initialize() {
  if (!csrfToken) throw new Error('Workstation request token is unavailable.');
  catalog = await apiRequest('/api/templates');
  renderTemplateOptions();
  renderStaticOptions();
  selectTemplate(catalog.templates[0].templateId);
  await refreshDraftList({ announce: false });
  setStatus('Local record desk ready. No information leaves this workstation.', 'success');
}

elements.form.addEventListener('submit', (event) => event.preventDefault());
elements.form.addEventListener('input', schedulePreview);
elements.form.addEventListener('change', schedulePreview);
elements.templateSelect.addEventListener('change', () => {
  try {
    selectTemplate(elements.templateSelect.value);
    setStatus('Blank filing opened from the selected released template.', 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Template could not be opened.', 'error');
  }
});
elements.newFiling.addEventListener('click', () => {
  selectTemplate(elements.templateSelect.value);
  setStatus('Blank filing initialized. Unsaved values were cleared.', 'success');
});
elements.sections.addEventListener('change', (event) => {
  if (event.target instanceof HTMLSelectElement && event.target.dataset.disclosureMode) {
    updateDisclosureState(event.target.dataset.disclosureMode);
  }
});
elements.saveDraft.addEventListener('click', saveDraft);
elements.exportDraft.addEventListener('click', exportDraft);
elements.refreshDrafts.addEventListener('click', () => {
  refreshDraftList().catch(() => setStatus('Local draft list could not be refreshed.', 'error'));
});
elements.loadDraft.addEventListener('click', async () => {
  const filename = elements.draftSelect.value;
  if (!filename) {
    setStatus('Select a stored draft first.', 'error');
    return;
  }
  try {
    const draft = await apiRequest(`/api/drafts/${encodeURIComponent(filename)}`);
    applyDraftPackage(draft);
    setStatus('Stored local draft loaded.', 'success');
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : 'Stored draft could not be loaded.',
      'error',
    );
  }
});
elements.importFile.addEventListener('change', async () => {
  try {
    await importDraftFile(elements.importFile.files?.[0]);
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : 'Draft package could not be imported.',
      'error',
    );
  } finally {
    elements.importFile.value = '';
  }
});
for (const button of elements.previewModes) {
  button.addEventListener('click', () => {
    previewMode = button.dataset.previewMode;
    for (const candidate of elements.previewModes) {
      candidate.classList.toggle('is-active', candidate === button);
      candidate.setAttribute('aria-pressed', candidate === button ? 'true' : 'false');
    }
    renderPreview();
  });
}

initialize().catch(() => {
  elements.workspaceTitle.textContent = 'Filing Workstation unavailable';
  setStatus(
    'Local form definitions could not be loaded. Stop and restart the workstation.',
    'error',
  );
});
