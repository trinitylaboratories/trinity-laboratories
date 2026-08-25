import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import {
  formatBytes,
  pngCrc32,
  validateAssetLedger,
  validateAssetRoot,
  validateDocxArchive,
  validatePdfPrivacy,
  validatePngPrivacy,
  validateStylesheet,
  validateSvg,
} from '../../scripts/validate-assets.mjs';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })),
  );
});

describe('asset policy', () => {
  const pngChunk = (type: string, data = new Uint8Array()) => {
    const typeBytes = new TextEncoder().encode(type);
    const chunk = new Uint8Array(12 + data.length);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, data.length, false);
    chunk.set(typeBytes, 4);
    chunk.set(data, 8);
    view.setUint32(8 + data.length, pngCrc32(chunk.subarray(4, 8 + data.length)), false);
    return chunk;
  };

  const pngFixture = (...extraChunks: Uint8Array[]) => {
    const signature = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    const ihdr = new Uint8Array(13);
    new DataView(ihdr.buffer).setUint32(0, 1, false);
    new DataView(ihdr.buffer).setUint32(4, 1, false);
    ihdr.set([8, 6, 0, 0, 0], 8);
    const chunks = [pngChunk('IHDR', ihdr), ...extraChunks, pngChunk('IDAT'), pngChunk('IEND')];
    const total = signature.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const png = new Uint8Array(total);
    let offset = 0;
    for (const part of [signature, ...chunks]) {
      png.set(part, offset);
      offset += part.length;
    }
    return png;
  };

  it('rejects active SVG and remote CSS', () => {
    expect(validateSvg('<svg><script>alert(1)</script></svg>', 'active.svg')).toEqual([
      expect.stringMatching(/scripts are prohibited/),
    ]);
    expect(validateStylesheet('@import "https://example.test/font.css";', 'remote.css')).toEqual([
      expect.stringMatching(/remote stylesheet imports/),
    ]);
  });

  it('reports forbidden deployable file formats', async () => {
    const parent = path.join(process.cwd(), '.tools', 'test-results');
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(path.join(parent, 'unit-assets-'));
    temporaryRoots.push(root);
    await writeFile(path.join(root, 'archive.zip'), 'not actually an archive', 'utf8');
    const result = await validateAssetRoot(root);
    expect(result.errors).toEqual([expect.stringMatching(/files are prohibited/)]);
  });

  it('rejects portraits and narrative artifacts even before ledger review', async () => {
    const parent = path.join(process.cwd(), '.tools', 'test-results');
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(path.join(parent, 'unit-release-scope-'));
    temporaryRoots.push(root);
    await writeFile(path.join(root, 'employee-portrait.jpg'), 'not an image', 'utf8');
    await writeFile(path.join(root, 'case-narrative.txt'), 'excluded story', 'utf8');
    const result = await validateAssetRoot(root);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/portrait or identity media/),
        expect.stringMatching(/narrative or evidence media/),
      ]),
    );
  });

  it('inspects DOCX packages for external links, comments, tracked changes, and metadata', () => {
    const archive = zipSync({
      'docProps/core.xml': strToU8(
        '<cp:coreProperties><dc:creator>Private Person</dc:creator></cp:coreProperties>',
      ),
      'docProps/app.xml': strToU8(
        '<Properties><Application>Microsoft Office Word</Application><Company>Private Company</Company></Properties>',
      ),
      'docProps/custom.xml': strToU8('<Properties />'),
      'word/_rels/document.xml.rels': strToU8(
        '<Relationships><Relationship TargetMode="External" Target="https://example.test/private" /></Relationships>',
      ),
      'word/comments.xml': strToU8('<w:comments />'),
      'word/document.xml': strToU8('<w:document><w:ins><w:t>change</w:t></w:ins></w:document>'),
    });
    expect(validateDocxArchive(archive, 'unsafe.docx')).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/external relationship/),
        expect.stringMatching(/comment metadata part/),
        expect.stringMatching(/tracked-change/),
        expect.stringMatching(/custom properties/),
        expect.stringMatching(/core property 'creator'/),
        expect.stringMatching(/extended property 'Application'/),
        expect.stringMatching(/extended property 'Company'/),
      ]),
    );

    const clean = zipSync({
      'docProps/core.xml': strToU8(
        '<cp:coreProperties><dc:creator></dc:creator></cp:coreProperties>',
      ),
      'docProps/app.xml': strToU8('<Properties><Application></Application></Properties>'),
      'word/_rels/document.xml.rels': strToU8(
        '<Relationships><Relationship Target="media/image1.png" /></Relationships>',
      ),
      'word/document.xml': strToU8('<w:document><w:p><w:t>Blank form</w:t></w:p></w:document>'),
    });
    expect(validateDocxArchive(clean, 'clean.docx')).toEqual([]);
  });

  it('rejects PDF personal Info values and XMP packets', () => {
    const unsafe = new TextEncoder().encode(
      '%PDF-1.7\n/Author (Private Person) /Producer (Source Tool) /CreationDate (D:20260101) /Metadata 7 0 R\n<x:xmpmeta>',
    );
    expect(validatePdfPrivacy(unsafe, 'unsafe.pdf')).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/XMP metadata/),
        expect.stringMatching(/'Author'/),
        expect.stringMatching(/'Producer'/),
        expect.stringMatching(/'CreationDate'/),
      ]),
    );
    expect(
      validatePdfPrivacy(new TextEncoder().encode('%PDF-1.7\n/Title (Public policy)'), 'clean.pdf'),
    ).toEqual([]);
  });

  it('rejects PNG metadata chunks and malformed or truncated structures', () => {
    const metadata = pngFixture(pngChunk('iTXt', new TextEncoder().encode('private metadata')));
    expect(validatePngPrivacy(metadata, 'unsafe.png')).toEqual([
      expect.stringMatching(/metadata chunk iTXt/),
    ]);
    const provenance = pngFixture(
      pngChunk('caBX', new TextEncoder().encode('C2PA provenance metadata')),
    );
    expect(validatePngPrivacy(provenance, 'provenance.png')).toEqual([
      expect.stringMatching(/metadata chunk caBX/),
    ]);
    expect(validatePngPrivacy(metadata.subarray(0, metadata.length - 2), 'truncated.png')).toEqual(
      expect.arrayContaining([expect.stringMatching(/truncated PNG chunk/)]),
    );
    expect(validatePngPrivacy(pngFixture(), 'clean.png')).toEqual([]);
  });

  it('formats byte counts for actionable output', () => {
    expect(formatBytes(8)).toBe('8 B');
    expect(formatBytes(2048)).toBe('2.0 KiB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MiB');
  });

  it('requires bidirectional ledger coverage and verified hashes', async () => {
    const parent = path.join(process.cwd(), '.tools', 'test-results');
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(path.join(parent, 'unit-ledger-'));
    temporaryRoots.push(root);
    const publicRoot = path.join(root, 'public');
    await mkdir(path.join(publicRoot, 'fonts'), { recursive: true });
    const payload = 'licensed fixture';
    await writeFile(path.join(publicRoot, 'fonts', 'asset.txt'), payload, 'utf8');
    const ledgerPath = path.join(root, 'asset-ledger.json');
    await writeFile(
      ledgerPath,
      JSON.stringify({
        hashAlgorithm: 'SHA-256',
        assets: [
          {
            category: 'third-party-font',
            source: {
              basename: 'asset.txt',
              sha256: createHash('sha256').update(payload).digest('hex'),
            },
            derivative: {
              path: '/fonts/asset.txt',
              sha256: createHash('sha256').update(payload).digest('hex'),
            },
            mediaType: 'text/plain',
            license: 'MIT',
            ownership: 'Fixture author',
            transform: 'Copied unchanged for the unit fixture.',
          },
        ],
      }),
      'utf8',
    );
    expect((await validateAssetLedger(publicRoot, ledgerPath)).errors).toEqual([]);

    const disallowedSourceLedger = JSON.parse(await readFile(ledgerPath, 'utf8'));
    disallowedSourceLedger.assets[0].source.basename = 'Longman-narrative.txt';
    await writeFile(ledgerPath, JSON.stringify(disallowedSourceLedger), 'utf8');
    expect((await validateAssetLedger(publicRoot, ledgerPath)).errors).toEqual([
      expect.stringMatching(/source\.basename contains narrative or evidence media/),
    ]);

    disallowedSourceLedger.assets[0].source.basename = 'asset.txt';
    await writeFile(ledgerPath, JSON.stringify(disallowedSourceLedger), 'utf8');

    await writeFile(path.join(publicRoot, 'unlisted.txt'), 'not ledgered', 'utf8');
    expect((await validateAssetLedger(publicRoot, ledgerPath)).errors).toEqual([
      expect.stringMatching(/not listed/),
    ]);
  });
});
