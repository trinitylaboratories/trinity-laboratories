import { spawn } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { isMain } from './lib/cli.mjs';

const MAX_INSTALL_ATTEMPTS = 8;
const RETRYABLE_INSTALL_OUTPUT = /\b(?:EBUSY|EPERM)\b/;

function appendBounded(output, chunk) {
  const combined = `${output}${chunk}`;
  return combined.length > 262_144 ? combined.slice(-262_144) : combined;
}

export async function resolveNpmCli(
  npmExecPath = process.env.npm_execpath,
  {
    platform = process.platform,
    execPath = process.execPath,
    projectRoot = process.env.TRINITY_PROJECT_ROOT || process.cwd(),
  } = {},
) {
  if (!npmExecPath?.trim()) {
    throw new Error('npm_execpath must identify the exact npm CLI used to run cf:install');
  }
  const npmCli = path.resolve(npmExecPath);
  const npmCliStats = await stat(npmCli).catch(() => null);
  if (!npmCliStats?.isFile()) {
    throw new Error(`npm_execpath is not a file: ${npmCli}`);
  }
  const resolvedNpmCli = await realpath(npmCli);

  if (platform === 'win32') {
    const runtimeRoot = await realpath(path.join(projectRoot, '.tools', 'node')).catch(() => null);
    const expectedNode = await realpath(path.join(projectRoot, '.tools', 'node', 'node.exe')).catch(
      () => null,
    );
    const resolvedExecPath = await realpath(execPath).catch(() => null);
    if (
      !runtimeRoot ||
      !expectedNode ||
      !resolvedExecPath ||
      resolvedExecPath.toLowerCase() !== expectedNode.toLowerCase()
    ) {
      throw new Error('Windows cf:install must run with the project-local .tools/node/node.exe');
    }
    const npmRelative = path.relative(runtimeRoot, resolvedNpmCli);
    if (
      npmRelative === '' ||
      npmRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(npmRelative)
    ) {
      throw new Error(
        'Windows npm_execpath must reside within the same project-local Node runtime',
      );
    }
  }

  return resolvedNpmCli;
}

export async function runNpmCiAttempt({
  npmCli,
  spawnImplementation = spawn,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImplementation(process.execPath, [npmCli, 'ci', '--ignore-scripts'], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output = appendBounded(output, chunk);
      stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output = appendBounded(output, chunk);
      stderr.write(chunk);
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, output, signal }));
  });
}

export async function retryLockedInstall({
  runAttempt,
  waitImplementation = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  reportRetry = (message) => console.warn(message),
  maxAttempts = MAX_INSTALL_ATTEMPTS,
} = {}) {
  if (typeof runAttempt !== 'function') throw new Error('runAttempt must be a function');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_INSTALL_ATTEMPTS) {
    throw new Error(`maxAttempts must be an integer from 1 to ${MAX_INSTALL_ATTEMPTS}`);
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await runAttempt(attempt);
    if (result.code === 0) return { ...result, attempts: attempt };

    const retryable = RETRYABLE_INSTALL_OUTPUT.test(result.output ?? '');
    if (!retryable || attempt === maxAttempts) return { ...result, attempts: attempt };

    const delayMs = Math.min(250 * attempt, 1_000);
    reportRetry(`npm ci hit a transient Windows lock; retrying ${attempt + 1}/${maxAttempts}.`);
    await waitImplementation(delayMs);
  }

  throw new Error('Unreachable install retry state');
}

export async function installLocked() {
  const npmCli = await resolveNpmCli();
  return retryLockedInstall({ runAttempt: () => runNpmCiAttempt({ npmCli }) });
}

async function main() {
  const result = await installLocked();
  if (result.signal) console.error(`npm ci exited with signal ${result.signal}`);
  process.exitCode = Number.isInteger(result.code) ? result.code : 1;
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
