import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  MAX_DRAFT_BYTES,
  assertPathInside,
  assertRecordMatchesDefinition,
  isSafeDraftFilename,
  parsePortArgument,
  requestAuthorityIsValid,
  stableJson,
  toPublicRecord,
  validateDraftPackage,
} from '../../tools/record-desk/core.mjs';
import {
  DEFAULT_OUTPUT_DIRECTORY,
  assertImportBranch,
  parseImportArguments,
  readCurrentBranch,
  stageDraftPackage,
} from '../../scripts/import-record.mjs';
import {
  PROJECT_ROOT,
  createRecordDeskServer,
  listenRecordDesk,
} from '../../scripts/record-desk-server.mjs';
import { loadDefinitionCatalog } from '../../scripts/validate-form-definitions.mjs';

type Definition = {
  templateId: string;
  title: string;
  family: string;
  informationLevel: string;
  sections: Array<{ id: string; title: string; fields: Array<{ id: string }> }>;
};

let definition: Definition;
const cleanupDirectories: string[] = [];

beforeAll(async () => {
  const catalog = await loadDefinitionCatalog();
  definition = catalog.templates[0];
});

afterEach(async () => {
  while (cleanupDirectories.length > 0) {
    const directory = cleanupDirectories.pop();
    if (!directory) continue;
    assertPathInside(path.join(PROJECT_ROOT, '.tools'), directory, 'Test fixture');
    await fs.rm(directory, {
      force: true,
      recursive: true,
      maxRetries: 8,
      retryDelay: 125,
    });
  }
});

function makeDraft() {
  return {
    draftVersion: 1,
    templateId: definition.templateId,
    updatedAt: '2026-08-24T12:00:00.000Z',
    record: {
      recordId: 'TL-101-TRN-001',
      formId: definition.templateId,
      title: 'Instrument calibration repeatability study',
      recordType: 'completed-report',
      recordFamily: definition.family,
      status: 'active',
      revision: '1.0',
      effectiveDate: '2026-08-24',
      controllingOffice: 'Applied Research Administration',
      publicationState: 'controlled',
      information: { level: definition.informationLevel },
      facilityCondition: 'WHITE',
      tags: ['calibration', 'training-record'],
      summary:
        'A neutral training record documenting routine calibration repeatability and review controls.',
      relatedRecords: [definition.templateId],
      sections: definition.sections.map((section, index) => ({
        id: section.id,
        title: section.title,
        disclosure:
          index === 1
            ? { mode: 'authorize', requiredLevel: 'TL-3' }
            : index === 2
              ? { mode: 'withheld' }
              : { mode: 'open' },
        ...(index === 2 ? {} : { body: '**Training entry:** Public-safe neutral test content.' }),
      })),
    },
    workstation: {
      fieldValues: Object.fromEntries(
        definition.sections.map((section, index) => [
          section.id,
          index === 2 ? {} : { [section.fields[0].id]: 'Public-safe neutral test content.' },
        ]),
      ),
    },
    safetyChecklist: {
      rightsConfirmed: true,
      noRealSecrets: true,
      personalDataReviewed: true,
      withheldContentRemoved: true,
    },
  };
}

async function fixtureRoot() {
  const toolsRoot = path.join(PROJECT_ROOT, '.tools');
  await fs.mkdir(toolsRoot, { recursive: true });
  const directory = await fs.mkdtemp(path.join(toolsRoot, 'record-desk-test-'));
  cleanupDirectories.push(directory);
  return directory;
}

function request(
  origin: string,
  pathname: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>(
    (resolve, reject) => {
      const url = new URL(pathname, origin);
      const outgoing = http.request(
        url,
        { method: options.method ?? 'GET', headers: options.headers },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () =>
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            }),
          );
        },
      );
      outgoing.on('error', reject);
      if (options.body) outgoing.write(options.body);
      outgoing.end();
    },
  );
}

describe('record desk package policy', () => {
  it('validates publication packages and strips workstation-only state deterministically', () => {
    const draft = makeDraft();
    Object.assign(draft, {
      badgeId: 'BADGE-RAW-SENTINEL',
      csrfToken: 'CSRF-RAW-SENTINEL',
      terminalCode: 'CODE-RAW-SENTINEL',
    });
    Object.assign(draft.record, { credential: 'CREDENTIAL-RAW-SENTINEL' });
    draft.workstation.fieldValues[definition.sections[0].id][definition.sections[0].fields[0].id] =
      'WORKSTATION-RAW-SENTINEL';
    expect(validateDraftPackage(draft, { forPublication: true })).toBe(true);
    expect(assertRecordMatchesDefinition(draft, definition)).toBe(true);
    const publicRecord = toPublicRecord(draft);
    expect(publicRecord).not.toHaveProperty('updatedAt');
    expect(publicRecord).not.toHaveProperty('workstation');
    expect(publicRecord).not.toHaveProperty('safetyChecklist');
    expect(publicRecord.sections[2]).toEqual({
      id: definition.sections[2].id,
      title: definition.sections[2].title,
      disclosure: { mode: 'withheld' },
    });
    expect(stableJson(publicRecord)).not.toMatch(
      /BADGE-RAW-SENTINEL|CSRF-RAW-SENTINEL|CODE-RAW-SENTINEL|CREDENTIAL-RAW-SENTINEL|WORKSTATION-RAW-SENTINEL/,
    );
    expect(stableJson(toPublicRecord(structuredClone(draft)))).toBe(stableJson(publicRecord));
  });

  it('rejects withheld plaintext, incomplete review, invalid conditions, and detached or main branches', () => {
    const withPlaintext = makeDraft();
    withPlaintext.record.sections[2].body = 'This must not survive.';
    expect(() => validateDraftPackage(withPlaintext)).toThrow(/must not contain body text/i);

    const retainedField = makeDraft();
    retainedField.workstation.fieldValues[definition.sections[2].id] = { hidden: 'retained' };
    expect(() => validateDraftPackage(retainedField)).toThrow(/must not retain/i);

    const unchecked = makeDraft();
    unchecked.safetyChecklist.noRealSecrets = false;
    expect(() => validateDraftPackage(unchecked, { forPublication: true })).toThrow(
      /must be confirmed/i,
    );

    const invalidCondition = makeDraft();
    invalidCondition.record.facilityCondition = 'GREEN';
    expect(() => validateDraftPackage(invalidCondition)).toThrow(/facilityCondition/i);

    const missingFormReference = makeDraft();
    missingFormReference.record.relatedRecords = [];
    expect(() => validateDraftPackage(missingFormReference, { forPublication: true })).toThrow(
      /originating formId/i,
    );

    expect(() => assertImportBranch('main')).toThrow(/refused on main/i);
    expect(() => assertImportBranch(null)).toThrow(/detached HEAD/i);
    expect(assertImportBranch('codex/record-desk')).toBe('codex/record-desk');
  });

  it('accepts only constrained filenames, ports, authorities, and importer arguments', () => {
    expect(isSafeDraftFilename('tl-101-trn-001.tirn-draft.json')).toBe(true);
    expect(isSafeDraftFilename('../record.tirn-draft.json')).toBe(false);
    expect(isSafeDraftFilename('record.json')).toBe(false);
    expect(parsePortArgument([])).toBe(4319);
    expect(parsePortArgument(['--port', '5419'])).toBe(5419);
    expect(() => parsePortArgument(['--host', '0.0.0.0'])).toThrow(/Usage/);
    expect(() => parsePortArgument(['--port', '80'])).toThrow(/1024/);
    expect(requestAuthorityIsValid({ host: '127.0.0.1:4319' }, 4319)).toBe(true);
    expect(requestAuthorityIsValid({ host: 'localhost:4319' }, 4319)).toBe(false);
    expect(
      requestAuthorityIsValid({ host: '127.0.0.1:4319', origin: 'http://127.0.0.1:4319' }, 4319, {
        requireOrigin: true,
      }),
    ).toBe(true);
    expect(
      requestAuthorityIsValid(
        { host: '127.0.0.1:4319', origin: 'https://attacker.invalid' },
        4319,
        { requireOrigin: true },
      ),
    ).toBe(false);
    expect(parseImportArguments(['draft.tirn-draft.json'])).toEqual({
      inputPath: 'draft.tirn-draft.json',
      outputDirectory: DEFAULT_OUTPUT_DIRECTORY,
    });
    expect(() => parseImportArguments(['draft.json'])).toThrow(/extension/i);
    expect(() =>
      parseImportArguments(['draft.tirn-draft.json', '--output-dir', path.resolve('outside')]),
    ).toThrow(/repository-relative/i);
  });
});

describe('record desk importer', () => {
  it('reads branch metadata from repositories and linked worktrees through stable handles', async () => {
    const repositoryRoot = await fixtureRoot();
    await fs.mkdir(path.join(repositoryRoot, '.git'));
    await fs.writeFile(path.join(repositoryRoot, '.git', 'HEAD'), 'ref: refs/heads/codex/direct\n');
    expect(await readCurrentBranch(repositoryRoot)).toBe('codex/direct');

    const worktreeRoot = await fixtureRoot();
    const worktreeGitDirectory = path.join(worktreeRoot, '.worktree-git');
    await fs.mkdir(worktreeGitDirectory);
    await fs.writeFile(path.join(worktreeGitDirectory, 'HEAD'), 'ref: refs/heads/codex/worktree\n');
    await fs.writeFile(path.join(worktreeRoot, '.git'), 'gitdir: .worktree-git\n');
    expect(await readCurrentBranch(worktreeRoot)).toBe('codex/worktree');
  });

  it('stages canonical public JSON on a working branch and refuses collisions', async () => {
    const root = await fixtureRoot();
    await fs.mkdir(path.join(root, 'data', 'form-definitions'), { recursive: true });
    await fs.copyFile(
      path.join(PROJECT_ROOT, 'data', 'form-definitions', 'forms.json'),
      path.join(root, 'data', 'form-definitions', 'forms.json'),
    );
    const draftDirectory = path.join(root, '.authoring', 'drafts');
    await fs.mkdir(draftDirectory, { recursive: true });
    const source = path.join(draftDirectory, 'tl-101-trn-001.tirn-draft.json');
    const draft = makeDraft();
    await fs.writeFile(source, stableJson(draft));

    const result = await stageDraftPackage({
      root,
      inputPath: path.relative(root, source),
      branch: 'codex/record-desk',
    });
    expect(result.relativePath).toBe('src/content/submissions/tl-101-trn-001.json');
    expect(JSON.parse(await fs.readFile(result.destinationPath, 'utf8'))).toEqual(
      toPublicRecord(draft),
    );
    await expect(
      stageDraftPackage({
        root,
        inputPath: path.relative(root, source),
        branch: 'codex/record-desk',
      }),
    ).rejects.toThrow(/already exists/i);
  });

  it('rejects packages over 1 MiB before parsing', async () => {
    const root = await fixtureRoot();
    const source = path.join(root, 'oversize.tirn-draft.json');
    await fs.writeFile(source, Buffer.alloc(MAX_DRAFT_BYTES + 1, 0x20));
    await expect(
      stageDraftPackage({ root, inputPath: path.basename(source), branch: 'codex/record-desk' }),
    ).rejects.toThrow(/exceeds/i);
  });

  it('rejects a directory in place of a draft file', async () => {
    const root = await fixtureRoot();
    const source = path.join(root, 'directory.tirn-draft.json');
    await fs.mkdir(source);
    await expect(
      stageDraftPackage({ root, inputPath: path.basename(source), branch: 'codex/record-desk' }),
    ).rejects.toThrow(/regular file/i);
  });
});

describe('loopback record desk server', () => {
  it('binds to loopback and enforces Host, Origin, CSRF, path, and response policy', async () => {
    const draftDirectory = path.join(await fixtureRoot(), 'drafts');
    const instance = await listenRecordDesk({
      root: PROJECT_ROOT,
      draftDirectory,
      port: 0,
      csrfToken: 'unit-test-csrf-token',
    });
    try {
      const address = instance.server.address();
      expect(address && typeof address === 'object' ? address.address : '').toBe('127.0.0.1');

      const home = await request(instance.origin, '/');
      expect(home.status).toBe(200);
      expect(home.body).toContain('unit-test-csrf-token');
      expect(home.headers['set-cookie']).toBeUndefined();
      expect(home.headers['access-control-allow-origin']).toBeUndefined();
      expect(home.headers['content-security-policy']).toContain("connect-src 'self'");
      expect(home.headers['cache-control']).toContain('no-store');

      const noCsrf = await request(instance.origin, '/api/templates');
      expect(noCsrf.status).toBe(403);
      const templates = await request(instance.origin, '/api/templates', {
        headers: { 'X-TIRN-CSRF': 'unit-test-csrf-token' },
      });
      expect(templates.status).toBe(200);

      const badHost = await request(instance.origin, '/', {
        headers: { Host: 'localhost.invalid' },
      });
      expect(badHost.status).toBe(403);

      const body = stableJson(makeDraft());
      const hostileOrigin = await request(
        instance.origin,
        '/api/drafts/tl-101-trn-001.tirn-draft.json',
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://attacker.invalid',
            'X-TIRN-CSRF': 'unit-test-csrf-token',
          },
          body,
        },
      );
      expect(hostileOrigin.status).toBe(403);

      const traversal = await request(
        instance.origin,
        '/api/drafts/%2e%2e%2foutside.tirn-draft.json',
        {
          headers: { 'X-TIRN-CSRF': 'unit-test-csrf-token' },
        },
      );
      expect(traversal.status).toBe(400);

      const stored = await request(instance.origin, '/api/drafts/tl-101-trn-001.tirn-draft.json', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Origin: instance.origin,
          'X-TIRN-CSRF': 'unit-test-csrf-token',
        },
        body,
      });
      expect(stored.status).toBe(200);
      expect(JSON.parse(stored.body)).toEqual({
        saved: true,
        filename: 'tl-101-trn-001.tirn-draft.json',
      });

      const retrieved = await request(
        instance.origin,
        '/api/drafts/tl-101-trn-001.tirn-draft.json',
        { headers: { 'X-TIRN-CSRF': 'unit-test-csrf-token' } },
      );
      expect(retrieved.status).toBe(200);
      expect(JSON.parse(retrieved.body)).toEqual(makeDraft());
    } finally {
      await new Promise<void>((resolve) => instance.server.close(() => resolve()));
    }
  });

  it('generates an independent random CSRF token for each process instance', async () => {
    const firstDirectory = path.join(await fixtureRoot(), 'drafts');
    const secondDirectory = path.join(await fixtureRoot(), 'drafts');
    const first = await createRecordDeskServer({
      root: PROJECT_ROOT,
      draftDirectory: firstDirectory,
    });
    const second = await createRecordDeskServer({
      root: PROJECT_ROOT,
      draftDirectory: secondDirectory,
    });
    expect(first.csrfToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(second.csrfToken).not.toBe(first.csrfToken);
    first.server.close();
    second.server.close();
  });

  it('keeps the client free of remote URLs, telemetry, cookies, and browser storage', async () => {
    const client = await fs.readFile(
      path.join(PROJECT_ROOT, 'tools', 'record-desk', 'public', 'app.js'),
      'utf8',
    );
    expect(client).not.toMatch(/https?:\/\//);
    expect(client).not.toMatch(
      /localStorage|sessionStorage|indexedDB|sendBeacon|document\.cookie/i,
    );
    expect(client).toContain("credentials: 'omit'");
  });
});
