import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isMain } from './lib/cli.mjs';

export function astroArguments(command, args = [], env = process.env) {
  const resolved = [command, ...args];
  const configFile = env.TRINITY_ASTRO_CONFIG_FILE?.trim();
  if (
    configFile &&
    !args.some((argument) => argument === '--config' || argument.startsWith('--config='))
  ) {
    resolved.push('--config', configFile);
  }
  return resolved;
}

export function astroChildEnvironment(command, env = process.env) {
  const childEnvironment = { ...env };
  if (command === 'dev') childEnvironment.ASTRO_DEV_BACKGROUND = '0';
  if (command === 'preview') childEnvironment.ASTRO_PREVIEW_BACKGROUND = '0';
  return childEnvironment;
}

export async function runAstro({
  command,
  args = [],
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  if (!/^(?:check|dev|preview|sync)$/.test(command ?? '')) {
    throw new Error(`Unsupported Astro command: ${String(command)}`);
  }
  const astroCli = fileURLToPath(new URL('../node_modules/astro/bin/astro.mjs', import.meta.url));
  const child = spawn(process.execPath, [astroCli, ...astroArguments(command, args, env)], {
    cwd,
    env: astroChildEnvironment(command, env),
    stdio: 'inherit',
    windowsHide: true,
  });
  return await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`Astro ${command} exited after signal ${signal}`));
      else resolve(code ?? 1);
    });
  });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  process.exitCode = await runAstro({ command, args });
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
