import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isMain } from './lib/cli.mjs';
import { inferDeploymentEnvironment } from './lib/deployment-policy.mjs';

const WORKER_NAME = 'trinity-laboratories';
const CLOUDFLARE_PREVIEW_HOST_LABEL_LIMIT = 63;

export function previewAlias(branch = '') {
  const maximumAliasLength = CLOUDFLARE_PREVIEW_HOST_LABEL_LIMIT - WORKER_NAME.length - 1;
  const prefix = 'preview-';
  const maximumSlugLength = maximumAliasLength - prefix.length;
  const slug = branch
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maximumSlugLength);
  const alias = `${prefix}${slug || 'branch'}`;
  if (`${alias}-${WORKER_NAME}`.length > CLOUDFLARE_PREVIEW_HOST_LABEL_LIMIT) {
    throw new Error('Cloudflare preview alias exceeds the 63-character hostname label limit');
  }
  return alias;
}

export function deploymentCommand(env = process.env, repositoryState) {
  const environment = inferDeploymentEnvironment(env);
  const environmentBranch =
    env.WORKERS_CI_BRANCH?.trim() ||
    env.GITHUB_REF_NAME?.trim() ||
    env.CF_PAGES_BRANCH?.trim() ||
    '';

  if (environment === 'production') {
    if (!repositoryState) {
      throw new Error('Production deploy requires a verified Git repository state');
    }
    const branch = environmentBranch || repositoryState.branch;
    const verifiedHead = repositoryState.head ?? '';
    const workersCi = env.WORKERS_CI === '1';
    const workersCommitSha = env.WORKERS_CI_COMMIT_SHA?.trim().toLowerCase() ?? '';
    const workersCommitMatches =
      workersCommitSha === '' || workersCommitSha === verifiedHead.toLowerCase();
    const workersMainIdentity = env.WORKERS_CI_BRANCH === 'main' && workersCommitMatches;
    const workersBranchState = repositoryState.branch === '' || repositoryState.branch === 'main';
    const attachedMain = !workersCi && branch === 'main' && repositoryState.branch === 'main';
    const verifiedWorkersMain = workersCi && workersMainIdentity && workersBranchState;
    if (!attachedMain && !verifiedWorkersMain) {
      throw new Error(
        `Refusing a production deploy from non-main or detached branch '${branch || 'unknown'}'.`,
      );
    }
    if (!/^[a-f0-9]{40,64}$/i.test(verifiedHead)) {
      throw new Error('Production deploy requires a resolvable committed Git HEAD');
    }
    if (!repositoryState.clean) {
      throw new Error(
        'Production deploy requires a clean working tree with no nonignored untracked files',
      );
    }
    return { args: ['deploy'], environment };
  }

  return {
    args: ['versions', 'upload', '--preview-alias', previewAlias(environmentBranch)],
    environment,
  };
}

function executeGit(args, { cwd = process.cwd(), execFileImplementation = execFile } = {}) {
  return new Promise((resolve, reject) => {
    execFileImplementation(
      'git',
      args,
      { cwd, encoding: 'utf8', windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `Unable to verify Git state with 'git ${args.join(' ')}': ${String(stderr || error.message).trim()}`,
              { cause: error },
            ),
          );
          return;
        }
        resolve(String(stdout).trim());
      },
    );
  });
}

export async function readGitDeploymentState(options = {}) {
  const [branch, head, status] = await Promise.all([
    executeGit(['branch', '--show-current'], options),
    executeGit(['rev-parse', '--verify', 'HEAD'], options),
    executeGit(['status', '--porcelain=v1', '--untracked-files=normal'], options),
  ]);
  return { branch, clean: status === '', head };
}

export async function resolveDeploymentCommand(env = process.env, options = {}) {
  const environment = inferDeploymentEnvironment(env);
  if (environment === 'preview') return deploymentCommand(env);
  return deploymentCommand(env, await readGitDeploymentState(options));
}

export async function deploySite(env = process.env, options = {}) {
  const command = await resolveDeploymentCommand(env, options);
  console.log(`Cloudflare ${command.environment} command: wrangler ${command.args.join(' ')}`);
  const wranglerCli = fileURLToPath(import.meta.resolve('wrangler'));
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wranglerCli, ...command.args], {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else
        reject(new Error(`Wrangler exited with ${signal ? `signal ${signal}` : `code ${code}`}.`));
    });
  });
  return command;
}

async function main() {
  await deploySite();
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
