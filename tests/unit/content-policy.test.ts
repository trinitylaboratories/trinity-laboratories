import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LEGACY_INFORMATION_LEVELS,
  parseFrontmatter,
  validateContent,
} from '../../scripts/validate-content.mjs';

const temporaryRoots: string[] = [];

async function fixtureRoot() {
  const parent = path.join(process.cwd(), '.tools', 'test-results');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'unit-content-'));
  temporaryRoots.push(root);
  await mkdir(path.join(root, 'content'), { recursive: true });
  await mkdir(path.join(root, 'public', 'downloads'), { recursive: true });
  return root;
}

function recordFrontmatter({
  id = 'TL-TEST-1',
  hash,
  related = '[]',
  level = 'TL-1',
  recordType = 'policy',
  publicationState = '',
  pagefind = '',
}: {
  id?: string;
  hash: string;
  related?: string;
  level?: string;
  recordType?: string;
  publicationState?: string;
  pagefind?: string;
}) {
  return `---
title: Test record
recordId: ${id}
recordType: ${recordType}
recordFamily: security
status: active
revision: "1"
${publicationState ? `publicationState: ${publicationState}\n` : ''}${pagefind ? `pagefind: ${pagefind}\n` : ''}legacyMarking:
  level: I
  label: Institutional
information:
  level: ${level}
tags: [test]
relatedRecords: ${related}
attachments:
  - label: Test attachment
    path: /downloads/test.txt
    mediaType: text/plain
    sourceFilename: test.txt
    sha256: ${hash}
---
# Test
`;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })),
  );
});

describe('content policy', () => {
  it('defines the locked legacy information crosswalk', () => {
    expect(LEGACY_INFORMATION_LEVELS).toEqual({
      I: 'TL-1',
      II: 'TL-2',
      III: 'TL-3',
      IV: 'TL-4',
      V: 'TL-5',
    });
  });

  it('accepts complete record metadata and a verified attachment', async () => {
    const root = await fixtureRoot();
    const payload = 'fixture attachment';
    const hash = createHash('sha256').update(payload).digest('hex');
    await writeFile(path.join(root, 'public', 'downloads', 'test.txt'), payload, 'utf8');
    await writeFile(path.join(root, 'content', 'record.md'), recordFrontmatter({ hash }), 'utf8');
    const result = await validateContent({
      contentRoot: path.join(root, 'content'),
      publicRoot: path.join(root, 'public'),
    });
    expect(result.errors).toEqual([]);
    expect(result.recordCount).toBe(1);
  });

  it('rejects route relationships, missing records, bad hashes, and an incorrect crosswalk', async () => {
    const root = await fixtureRoot();
    await writeFile(
      path.join(root, 'public', 'downloads', 'test.txt'),
      'fixture attachment',
      'utf8',
    );
    await writeFile(
      path.join(root, 'content', 'record.md'),
      recordFrontmatter({
        hash: 'f'.repeat(64),
        level: 'TL-4',
        related: '[/records/security/]',
      }),
      'utf8',
    );
    const result = await validateContent({
      contentRoot: path.join(root, 'content'),
      publicRoot: path.join(root, 'public'),
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/must map to information\.level TL-1/),
        expect.stringMatching(/record IDs, not routes/),
        expect.stringMatching(/sha256 mismatch/),
      ]),
    );
  });

  it('rejects duplicate YAML keys during frontmatter parsing', () => {
    expect(() => parseFrontmatter('---\nrecordId: TL-A\nrecordId: TL-B\n---\n')).toThrow(
      /invalid YAML frontmatter/,
    );
  });

  it('rejects search indexing or public-release status on TL-3+ form templates', async () => {
    const root = await fixtureRoot();
    const payload = 'fixture attachment';
    const hash = createHash('sha256').update(payload).digest('hex');
    await writeFile(path.join(root, 'public', 'downloads', 'test.txt'), payload, 'utf8');
    await writeFile(
      path.join(root, 'content', 'record.md'),
      recordFrontmatter({
        hash,
        level: 'TL-3',
        recordType: 'form-template',
        publicationState: 'released',
      }),
      'utf8',
    );
    const result = await validateContent({
      contentRoot: path.join(root, 'content'),
      publicRoot: path.join(root, 'public'),
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/TL-3\+ form templates must set pagefind: false/),
        expect.stringMatching(/TL-3\+ records may not declare publicationState: released/),
      ]),
    );
  });

  it('allows controlled policy sources to remain with their controlling office', async () => {
    const root = await fixtureRoot();
    const policy = `---
title: Controlled policy
recordId: TL-SEC-X
recordType: policy
recordFamily: security
status: active
revision: "1"
pagefind: false
information:
  level: TL-4
tags: [security]
relatedRecords: [TL-SEC-X-REF]
attachments: []
---
# Controlled policy
`;
    const reference = `---
title: Controlled reference
recordId: TL-SEC-X-REF
recordType: security-reference
recordFamily: security
status: active
revision: "1"
pagefind: false
information:
  level: TL-4
tags: [security, reference]
relatedRecords: [TL-SEC-X]
attachments: []
---
# Controlled reference
`;
    await writeFile(path.join(root, 'content', 'policy.md'), policy, 'utf8');
    await writeFile(path.join(root, 'content', 'reference.md'), reference, 'utf8');

    const result = await validateContent({
      contentRoot: path.join(root, 'content'),
      publicRoot: path.join(root, 'public'),
    });
    expect(result.errors).toEqual([]);
  });
});
