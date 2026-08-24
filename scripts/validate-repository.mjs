import { execFile as execFileCallback } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { isMain, printErrors } from './lib/cli.mjs';
import { DEFAULT_IGNORED_DIRECTORIES, pathExists, toPosix, walkFiles } from './lib/filesystem.mjs';

const execFile = promisify(execFileCallback);

const REQUIRED_FILES = Object.freeze([
  '.gitignore',
  '.gitattributes',
  'README.md',
  'LICENSE',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SECURITY.md',
  'package.json',
  'package-lock.json',
  'wrangler.jsonc',
  'scripts/run-local.ps1',
  '.github/dependabot.yml',
  '.github/workflows/ci.yml',
  '.github/workflows/codeql.yml',
  '.github/workflows/dependency-review.yml',
]);

const REQUIRED_PACKAGE_SCRIPTS = Object.freeze([
  'build',
  'cf:build',
  'cf:deploy',
  'check',
  'test:unit',
  'test:e2e',
  'validate:repo',
  'validate:assets',
  'validate:content',
  'validate:dist',
  'validate:site',
  'prepare:deploy',
]);

const FORBIDDEN_TRACKED_SEGMENTS = Object.freeze([
  '/_IgnoreThis/',
  '/.astro/',
  '/.cache/',
  '/.wrangler/',
  '/coverage/',
  '/dist/',
  '/node_modules/',
  '/output/',
  '/playwright-report/',
  '/test-results/',
]);

const FORBIDDEN_FILE_NAMES = new Set(['.DS_Store', '.env', 'Thumbs.db', 'desktop.ini']);

const SECRET_PATTERNS = Object.freeze([
  ['private key', /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/],
  ['GitHub token', /gh[pousr]_[A-Za-z0-9]{20,}/],
  ['Cloudflare account token', /cfat_[A-Za-z0-9_-]{20,}/],
  ['AWS access key', /(?:AKIA|ASIA)[A-Z0-9]{16}/],
  ['npm token', /npm_[A-Za-z0-9]{30,}/],
  ['Slack webhook', /https:\/\/hooks\.slack\.com\/services\/[A-Z0-9/]{20,}/i],
]);

const TEXT_EXTENSIONS = new Set([
  '',
  '.astro',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsonc',
  '.md',
  '.mdx',
  '.mjs',
  '.mts',
  '.ps1',
  '.scss',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

export function validateWorkflowSource(source, fileName = 'workflow.yml') {
  const errors = [];

  if (!/^permissions\s*:/m.test(source)) {
    errors.push(`${fileName}: declare explicit top-level permissions`);
  }
  if (/^\s*pull_request_target\s*:/m.test(source)) {
    errors.push(`${fileName}: pull_request_target is prohibited`);
  }
  if (
    /permissions\s*:\s*write-all/i.test(source) ||
    /^\s*contents\s*:\s*write\s*$/im.test(source)
  ) {
    errors.push(`${fileName}: broad or contents write permissions are prohibited`);
  }
  if (/\bCLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)\b/i.test(source)) {
    errors.push(`${fileName}: GitHub Actions must not receive Cloudflare credentials`);
  }
  if (/cloudflare\/wrangler-action@|\bwrangler\s+(?:deploy|versions\s+upload)\b/i.test(source)) {
    errors.push(`${fileName}: deployment belongs to native Cloudflare Workers Builds`);
  }

  const externalUses = [...source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)].map((match) =>
    match[1].replace(/["']/g, ''),
  );

  for (const action of externalUses) {
    if (action.startsWith('./') || action.startsWith('docker://')) continue;
    const separator = action.lastIndexOf('@');
    const revision = separator === -1 ? '' : action.slice(separator + 1);
    if (!/^[0-9a-f]{40}$/i.test(revision)) {
      errors.push(`${fileName}: action must be pinned to a full commit SHA: ${action}`);
    }
  }

  if (externalUses.some((action) => action.startsWith('actions/checkout@'))) {
    if (!/^\s*persist-credentials\s*:\s*false\s*$/im.test(source)) {
      errors.push(`${fileName}: checkout must set persist-credentials: false`);
    }
  }

  const runnerJobs = (source.match(/^\s*runs-on\s*:/gm) ?? []).length;
  const boundedJobs = (source.match(/^\s*timeout-minutes\s*:/gm) ?? []).length;
  if (boundedJobs < runnerJobs) {
    errors.push(`${fileName}: every runner job must define timeout-minutes`);
  }

  return errors;
}

export function validateCiSource(source, fileName = '.github/workflows/ci.yml') {
  const errors = [];
  if (
    !source.includes(
      'gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz',
    ) ||
    !source.includes('551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb')
  ) {
    errors.push(`${fileName}: Gitleaks must use the locked release and SHA-256 checksum`);
  }
  if (!/lycheeverse\/lychee-action@[0-9a-f]{40}/i.test(source)) {
    errors.push(`${fileName}: built HTML and Markdown require a pinned external-link check`);
  }
  for (const requirement of [
    ['Windows bootstrap job', /bootstrap-windows:/],
    ['checksum-verifying bootstrap', /\.\s+\.\/scripts\/bootstrap\.ps1/],
    ['project-local clean install', /\.tools\/node\/npm\.cmd ci --ignore-scripts/],
    ['lint gate', /npm run lint/],
    ['deployable asset gate', /npm run validate:dist/],
  ]) {
    if (!requirement[1].test(source)) errors.push(`${fileName}: missing ${requirement[0]}`);
  }
  return errors;
}

export function validateLocalLauncherSource(source, fileName = 'scripts/run-local.ps1') {
  const errors = [];
  const requirements = [
    ['safe npm-script token validation', /ValidatePattern\('\^\[A-Za-z0-9:_-\]\+\$'\)/],
    ['project-local npm executable', /\.tools\\node\\npm\.cmd/],
    ['project-local clean-path junction', /\.tools\\workspace-root/],
    ['junction type verification', /LinkType\s+-ne\s+'Junction'/],
    ['junction target verification', /Test-SamePath\s+\$junctionTarget\s+\$projectRoot/],
    ['unused drive verification', /Get-PSDrive\s+-Name/],
    ['subst mapping inspection', /Get-SubstMappings/],
    ['preserve-symlinks flag', /--preserve-symlinks(?:\s|')/],
    ['preserve-symlinks-main flag', /--preserve-symlinks-main/],
    ['clean Astro config alias', /TRINITY_ASTRO_CONFIG_FILE/],
    ['physical project root handoff', /TRINITY_PROJECT_ROOT/],
    ['project-local staged build handoff', /TRINITY_LOCAL_BUILD_STAGE/],
    ['Dropbox-ignored generated build output', /com\.dropbox\.ignored/],
    ['verified finally cleanup', /finally\s*\{/],
    ['clean alias working directory', /Push-Location\s+-LiteralPath\s+\$cleanRoot/],
    ['project-local child PATH', /"\$childNodeDirectory;\$previousProcessPath"/],
    ['PowerShell npm argument array', /&\s+\$npmPath\s+@npmArguments/],
    ['non-recursive junction deletion', /Directory\]::Delete\(\$junctionPath,\s*\$false\)/],
  ];
  for (const [label, pattern] of requirements) {
    if (!pattern.test(source)) errors.push(`${fileName}: missing ${label}`);
  }
  if (/Invoke-Expression|\bRemove-Item\b[^\n]*-Recurse/i.test(source)) {
    errors.push(`${fileName}: dynamic evaluation and recursive removal are prohibited`);
  }
  return errors;
}

export function validatePackageManifest(manifest, fileName = 'package.json') {
  const errors = [];
  if (manifest.private !== true)
    errors.push(`${fileName}: set private to true to prevent npm publishing`);
  if (!manifest.license || manifest.license === 'UNLICENSED') {
    errors.push(`${fileName}: declare the repository's open-source license`);
  }
  if (manifest.engines?.node !== '24.19.0') {
    errors.push(`${fileName}: engines.node must be pinned exactly to 24.19.0`);
  }
  if (manifest.engines?.npm !== '11.17.0') {
    errors.push(`${fileName}: engines.npm must be pinned exactly to 11.17.0`);
  }
  if (!/^npm@\d+\.\d+\.\d+$/.test(manifest.packageManager ?? '')) {
    errors.push(`${fileName}: pin packageManager to an exact npm version`);
  }

  for (const script of REQUIRED_PACKAGE_SCRIPTS) {
    if (typeof manifest.scripts?.[script] !== 'string') {
      errors.push(`${fileName}: missing required script '${script}'`);
    }
  }
  if (manifest.scripts?.build !== 'node scripts/build-site.mjs') {
    errors.push(`${fileName}: build must use the branch-aware scripts/build-site.mjs wrapper`);
  }
  if (manifest.scripts?.['cf:deploy'] !== 'node scripts/deploy-site.mjs') {
    errors.push(`${fileName}: cf:deploy must use the branch-aware scripts/deploy-site.mjs wrapper`);
  }
  if (manifest.scripts?.['cf:install'] !== 'node scripts/install-locked.mjs') {
    errors.push(`${fileName}: cf:install must use the bounded project-local install wrapper`);
  }
  for (const [script, command] of Object.entries({
    check: 'node scripts/run-astro.mjs check',
    dev: 'node scripts/run-astro.mjs dev',
    preview: 'node scripts/run-astro.mjs preview',
    sync: 'node scripts/run-astro.mjs sync',
  })) {
    if (manifest.scripts?.[script] !== command) {
      errors.push(`${fileName}: ${script} must use the clean-path-aware Astro wrapper`);
    }
  }
  for (const command of ['build', 'prepare:deploy', 'validate:dist', 'validate:site']) {
    if (!String(manifest.scripts?.['cf:build'] ?? '').includes(`npm run ${command}`)) {
      errors.push(`${fileName}: cf:build must run ${command}`);
    }
  }

  return errors;
}

export function validateWranglerConfig(config, fileName = 'wrangler.jsonc') {
  const errors = [];
  if (config.name !== 'trinity-laboratories') {
    errors.push(`${fileName}: name must be trinity-laboratories`);
  }
  if (config.compatibility_date !== '2026-08-24') {
    errors.push(`${fileName}: compatibility_date must be 2026-08-24`);
  }
  if (config.workers_dev !== false) errors.push(`${fileName}: workers_dev must be false`);
  if (config.preview_urls !== true) errors.push(`${fileName}: preview_urls must be true`);
  if (Object.hasOwn(config, 'main')) {
    errors.push(`${fileName}: a fully static asset Worker must not declare a runtime main entry`);
  }
  if (config.assets?.directory !== './dist') {
    errors.push(`${fileName}: assets.directory must be ./dist`);
  }
  if (config.assets?.html_handling !== 'auto-trailing-slash') {
    errors.push(`${fileName}: assets.html_handling must be auto-trailing-slash`);
  }
  if (config.assets?.not_found_handling !== '404-page') {
    errors.push(`${fileName}: assets.not_found_handling must be 404-page`);
  }
  if (Object.hasOwn(config.assets ?? {}, 'binding')) {
    errors.push(`${fileName}: static assets must not expose a runtime binding`);
  }
  if (Object.hasOwn(config.assets ?? {}, 'run_worker_first')) {
    errors.push(`${fileName}: static assets must not run Worker code before asset routing`);
  }
  const routes = Array.isArray(config.routes) ? config.routes : [];
  if (
    routes.length !== 1 ||
    routes[0]?.pattern !== 'trinitylaboratories.org' ||
    routes[0]?.custom_domain !== true
  ) {
    errors.push(
      `${fileName}: routes must contain only the apex trinitylaboratories.org custom domain`,
    );
  }
  if (JSON.stringify(config).includes('www.trinitylaboratories.org')) {
    errors.push(`${fileName}: www redirect belongs in Cloudflare, not the Worker route binding`);
  }
  return errors;
}

export function stripJsonComments(source) {
  let output = '';
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === '\n') {
        lineComment = false;
        output += character;
      }
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      } else if (character === '\n') {
        output += character;
      }
      continue;
    }
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      output += character;
    } else if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
    } else if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
    } else {
      output += character;
    }
  }
  return output;
}

export function stripJsonTrailingCommas(source) {
  let output = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      output += character;
      continue;
    }
    if (character === ',') {
      let nextIndex = index + 1;
      while (/\s/.test(source[nextIndex] ?? '')) nextIndex += 1;
      if (source[nextIndex] === '}' || source[nextIndex] === ']') continue;
    }
    output += character;
  }
  return output;
}

export function findSecrets(source, fileName) {
  const errors = [];
  for (const [label, pattern] of SECRET_PATTERNS) {
    if (pattern.test(source)) errors.push(`${fileName}: possible ${label}`);
  }
  return errors;
}

export function findLeakedLocalPaths(source, fileName) {
  const errors = [];
  const candidates = source.match(
    /(?:[A-Za-z]:[\\/]|\\\\[^\\/\s"'<>|]+[\\/][^\\/\s"'<>|]+[\\/])[^\s"'<>|]*/g,
  );
  for (const candidate of candidates ?? []) {
    const normalized = candidate.replaceAll('\\', '/');
    if (/^[A-Za-z]:\/Users\//i.test(normalized)) {
      errors.push(`${fileName}: absolute local user-profile path is prohibited`);
    } else if (/(?:^|\/)Dropbox(?:\/|$)/i.test(normalized)) {
      errors.push(`${fileName}: absolute Dropbox path is prohibited`);
    }
  }
  return [...new Set(errors)];
}

async function trackedFiles(projectRoot) {
  if (await pathExists(path.join(projectRoot, '.git'))) {
    const { stdout } = await execFile(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      {
        cwd: projectRoot,
        encoding: 'buffer',
        maxBuffer: 20 * 1024 * 1024,
      },
    );
    return stdout
      .toString('utf8')
      .split('\0')
      .filter(Boolean)
      .map(toPosix)
      .sort((left, right) => left.localeCompare(right));
  }

  const ignoredDirectories = new Set([...DEFAULT_IGNORED_DIRECTORIES, '_IgnoreThis']);
  return walkFiles(projectRoot, { ignoredDirectories });
}

export async function validateRepository(projectRoot = process.cwd()) {
  const errors = [];

  for (const requiredFile of REQUIRED_FILES) {
    if (!(await pathExists(path.join(projectRoot, requiredFile)))) {
      errors.push(`Missing required repository file: ${requiredFile}`);
    }
  }

  if (
    !(
      await Promise.all(
        ['astro.config.mjs', 'astro.config.ts', 'astro.config.js'].map((file) =>
          pathExists(path.join(projectRoot, file)),
        ),
      )
    ).some(Boolean)
  ) {
    errors.push('Missing Astro configuration (astro.config.mjs, .ts, or .js)');
  }

  const files = await trackedFiles(projectRoot);
  for (const relativeFile of files) {
    const normalized = `/${toPosix(relativeFile)}`;
    const baseName = path.posix.basename(normalized);

    if (FORBIDDEN_TRACKED_SEGMENTS.some((segment) => normalized.includes(segment))) {
      errors.push(`${relativeFile}: generated/private directory must not be tracked`);
    }
    if (FORBIDDEN_FILE_NAMES.has(baseName) || /^\.env\.(?!example$)/i.test(baseName)) {
      errors.push(`${relativeFile}: local environment file must not be tracked`);
    }
    if (/\.(?:map|pem|p12|pfx|key)$/i.test(relativeFile)) {
      errors.push(`${relativeFile}: source maps and credential containers must not be tracked`);
    }

    const absoluteFile = path.join(projectRoot, relativeFile);
    const fileStats = await lstat(absoluteFile).catch(() => null);
    if (!fileStats) continue;

    if (fileStats.isSymbolicLink()) {
      const target = await realpath(absoluteFile).catch(() => null);
      if (!target || path.relative(projectRoot, target).startsWith('..')) {
        errors.push(`${relativeFile}: symlink escapes the repository`);
      }
      continue;
    }

    if (fileStats.size > 25 * 1024 * 1024) {
      errors.push(`${relativeFile}: exceeds Cloudflare's 25 MiB static asset limit`);
    }

    if (fileStats.size <= 1024 * 1024 && TEXT_EXTENSIONS.has(path.extname(relativeFile))) {
      const source = await readFile(absoluteFile, 'utf8');
      errors.push(...findSecrets(source, relativeFile));
      errors.push(...findLeakedLocalPaths(source, relativeFile));
    }
  }

  const workflowFiles = files.filter((file) => /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(file));
  for (const workflowFile of workflowFiles) {
    const source = await readFile(path.join(projectRoot, workflowFile), 'utf8');
    errors.push(...validateWorkflowSource(source, workflowFile));
    if (workflowFile === '.github/workflows/ci.yml') {
      errors.push(...validateCiSource(source, workflowFile));
    }
  }

  const packagePath = path.join(projectRoot, 'package.json');
  if (await pathExists(packagePath)) {
    try {
      const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
      errors.push(...validatePackageManifest(manifest));
    } catch (error) {
      errors.push(`package.json: ${error instanceof Error ? error.message : 'invalid JSON'}`);
    }
  }

  const wranglerPath = path.join(projectRoot, 'wrangler.jsonc');
  if (await pathExists(wranglerPath)) {
    try {
      const config = JSON.parse(
        stripJsonTrailingCommas(stripJsonComments(await readFile(wranglerPath, 'utf8'))),
      );
      errors.push(...validateWranglerConfig(config));
    } catch (error) {
      errors.push(`wrangler.jsonc: ${error instanceof Error ? error.message : 'invalid JSONC'}`);
    }
  }

  const localLauncherPath = path.join(projectRoot, 'scripts', 'run-local.ps1');
  if (await pathExists(localLauncherPath)) {
    const source = await readFile(localLauncherPath, 'utf8');
    errors.push(...validateLocalLauncherSource(source));
  }

  const gitignorePath = path.join(projectRoot, '.gitignore');
  if (await pathExists(gitignorePath)) {
    const gitignore = await readFile(gitignorePath, 'utf8');
    const patterns = gitignore
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^\//, ''))
      .filter((line) => line && !line.startsWith('#'));
    for (const pattern of ['_IgnoreThis/', 'node_modules/', 'dist/', 'coverage/']) {
      if (!patterns.includes(pattern)) {
        errors.push(`.gitignore: missing required pattern '${pattern}'`);
      }
    }
    if (
      !patterns.includes('.env*') &&
      !(patterns.includes('.env') && patterns.includes('.env.*'))
    ) {
      errors.push('.gitignore: must ignore .env and .env.* files');
    }
  }

  return { errors, fileCount: files.length, workflowCount: workflowFiles.length };
}

async function main() {
  const result = await validateRepository();
  printErrors('Repository policy violations:', result.errors);

  if (result.errors.length > 0) {
    process.exitCode = 1;
    return;
  }

  console.log(
    `Repository policy passed for ${result.fileCount} tracked file(s) and ${result.workflowCount} workflow(s).`,
  );
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
