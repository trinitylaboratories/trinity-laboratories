import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  MAX_DRAFT_BYTES,
  assertPathInside,
  assertRecordMatchesDefinition,
  expectedOrigin,
  isSafeDraftFilename,
  parsePortArgument,
  requestAuthorityIsValid,
  stableJson,
  validateDraftPackage,
} from '../tools/record-desk/core.mjs';
import { readStableUtf8File } from './lib/stable-file-read.mjs';
import { loadDefinitionCatalog } from './validate-form-definitions.mjs';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DRAFT_DIRECTORY = path.join(PROJECT_ROOT, '.authoring', 'drafts');

const STATIC_FILES = Object.freeze({
  '/app.js': { filename: 'app.js', contentType: 'text/javascript; charset=utf-8' },
  '/styles.css': { filename: 'styles.css', contentType: 'text/css; charset=utf-8' },
});

const BASE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store, max-age=0',
  'Content-Security-Policy':
    "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy':
    'camera=(), geolocation=(), microphone=(), payment=(), usb=(), browsing-topics=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
});

function send(response, statusCode, body, contentType = 'text/plain; charset=utf-8', extra = {}) {
  response.writeHead(statusCode, {
    ...BASE_HEADERS,
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    ...extra,
  });
  response.end(body);
}

function sendJson(response, statusCode, value) {
  send(response, statusCode, stableJson(value), 'application/json; charset=utf-8');
}

export async function readJsonRequest(request, limit = MAX_DRAFT_BYTES) {
  const contentType = request.headers['content-type'];
  if (
    typeof contentType !== 'string' ||
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)
  ) {
    throw Object.assign(new Error('Content-Type must be application/json.'), { statusCode: 415 });
  }
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 });
    }
    chunks.push(chunk);
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Request body is not valid JSON.'), { statusCode: 400 });
  }
  return parsed;
}

function parseDraftRoute(pathname) {
  const prefix = '/api/drafts/';
  if (!pathname.startsWith(prefix)) return null;
  let name;
  try {
    name = decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return null;
  }
  return isSafeDraftFilename(name) ? name : null;
}

function csrfIsValid(headers, token) {
  const received = headers['x-tirn-csrf'];
  return typeof received === 'string' && received.length === token.length && received === token;
}

async function ensureDraftDirectory(root, configuredDirectory) {
  const directory = assertPathInside(root, configuredDirectory, 'Draft directory');
  await fs.mkdir(directory, { recursive: true });
  const realRoot = await fs.realpath(root);
  const realDirectory = await fs.realpath(directory);
  return assertPathInside(realRoot, realDirectory, 'Draft directory');
}

/**
 * @param {{ root?: string, draftDirectory?: string, csrfToken?: string }} [options]
 */
export async function createRecordDeskServer({
  root = PROJECT_ROOT,
  draftDirectory = path.join(root, '.authoring', 'drafts'),
  csrfToken = randomBytes(32).toString('base64url'),
} = {}) {
  const catalogPath = path.join(root, 'data', 'form-definitions', 'forms.json');
  const catalog = await loadDefinitionCatalog(catalogPath);
  const definitions = new Map(
    catalog.templates.map((definition) => [definition.templateId, definition]),
  );
  const publicDirectory = path.join(root, 'tools', 'record-desk', 'public');
  const indexTemplate = await fs.readFile(path.join(publicDirectory, 'index.html'), 'utf8');
  const staticAssets = new Map();
  for (const [route, descriptor] of Object.entries(STATIC_FILES)) {
    staticAssets.set(route, {
      body: await fs.readFile(path.join(publicDirectory, descriptor.filename)),
      contentType: descriptor.contentType,
    });
  }
  const safeDraftDirectory = await ensureDraftDirectory(root, draftDirectory);

  const server = http.createServer(async (request, response) => {
    const address = server.address();
    const port = address && typeof address === 'object' ? address.port : 4319;
    const origin = expectedOrigin(port);
    const method = request.method ?? 'GET';
    if (!requestAuthorityIsValid(request.headers, port, { requireOrigin: method !== 'GET' })) {
      sendJson(response, 403, { error: 'Request authority rejected.' });
      return;
    }
    let requestUrl;
    try {
      requestUrl = new URL(request.url ?? '/', origin);
    } catch {
      sendJson(response, 400, { error: 'Malformed request URL.' });
      return;
    }
    const pathname = requestUrl.pathname;
    if (requestUrl.origin !== origin || requestUrl.search || requestUrl.hash) {
      sendJson(response, 400, {
        error: 'Query strings and alternate authorities are not accepted.',
      });
      return;
    }

    try {
      if (method === 'GET' && pathname === '/') {
        const html = indexTemplate.replace('__CSRF_TOKEN__', csrfToken);
        send(response, 200, html, 'text/html; charset=utf-8');
        return;
      }
      if (method === 'GET' && pathname === '/favicon.ico') {
        send(response, 204, '', 'image/x-icon');
        return;
      }
      if (method === 'GET' && staticAssets.has(pathname)) {
        const asset = staticAssets.get(pathname);
        send(response, 200, asset.body, asset.contentType);
        return;
      }
      if (pathname.startsWith('/api/') && !csrfIsValid(request.headers, csrfToken)) {
        sendJson(response, 403, { error: 'Workstation request token rejected.' });
        return;
      }
      if (method === 'GET' && pathname === '/api/templates') {
        sendJson(response, 200, catalog);
        return;
      }
      if (method === 'GET' && pathname === '/api/drafts') {
        const names = (await fs.readdir(safeDraftDirectory))
          .filter((name) => isSafeDraftFilename(name))
          .sort((left, right) => left.localeCompare(right));
        sendJson(response, 200, { drafts: names });
        return;
      }
      const draftName = parseDraftRoute(pathname);
      if (draftName && method === 'GET') {
        const filePath = assertPathInside(
          safeDraftDirectory,
          path.join(safeDraftDirectory, draftName),
          'Draft path',
        );
        let draftFile;
        try {
          draftFile = await readStableUtf8File(filePath, {
            label: 'Stored draft',
            maxBytes: MAX_DRAFT_BYTES,
          });
        } catch (error) {
          if (error && typeof error === 'object' && error.code === 'ENOENT') {
            sendJson(response, 404, { error: 'Draft not found.' });
            return;
          }
          throw error;
        }
        const draft = JSON.parse(draftFile.text);
        validateDraftPackage(draft);
        const definition = definitions.get(draft.templateId);
        if (!definition) throw new Error('Stored draft references an unknown form template.');
        assertRecordMatchesDefinition(draft, definition);
        sendJson(response, 200, draft);
        return;
      }
      if (draftName && method === 'PUT') {
        const draft = await readJsonRequest(request);
        validateDraftPackage(draft);
        const definition = definitions.get(draft.templateId);
        if (!definition) {
          sendJson(response, 422, { error: 'Draft references an unknown form template.' });
          return;
        }
        assertRecordMatchesDefinition(draft, definition);
        const filePath = assertPathInside(
          safeDraftDirectory,
          path.join(safeDraftDirectory, draftName),
          'Draft path',
        );
        await fs.writeFile(filePath, stableJson(draft), { encoding: 'utf8', mode: 0o600 });
        sendJson(response, 200, { saved: true, filename: draftName });
        return;
      }
      if (pathname.startsWith('/api/drafts/')) {
        sendJson(response, 400, { error: 'Draft filename rejected.' });
        return;
      }
      if (method !== 'GET') {
        sendJson(response, 405, { error: 'Method not allowed.' });
        return;
      }
      send(response, 404, 'Not found.');
    } catch (error) {
      const statusCode =
        error && typeof error === 'object' && Number.isInteger(error.statusCode)
          ? error.statusCode
          : 422;
      const message =
        statusCode >= 500
          ? 'The workstation could not complete the request.'
          : error instanceof Error
            ? error.message
            : 'Request rejected.';
      sendJson(response, statusCode, { error: message });
    }
  });
  server.on('clientError', (_error, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  return { server, csrfToken };
}

/**
 * @param {{ port?: number, root?: string, draftDirectory?: string, csrfToken?: string }} [options]
 */
export async function listenRecordDesk({ port = 4319, ...options } = {}) {
  const instance = await createRecordDeskServer(options);
  await new Promise((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(port, '127.0.0.1', () => {
      instance.server.off('error', reject);
      resolve();
    });
  });
  const address = instance.server.address();
  const actualPort = address && typeof address === 'object' ? address.port : port;
  return { ...instance, port: actualPort, origin: expectedOrigin(actualPort) };
}

async function main() {
  const port = parsePortArgument(process.argv.slice(2));
  const instance = await listenRecordDesk({ port });
  console.log(`TIRN Filing Workstation: ${instance.origin}/`);
  console.log(`Drafts remain local under ${path.relative(PROJECT_ROOT, DRAFT_DIRECTORY)}.`);
  console.log('Press Ctrl+C to stop.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
