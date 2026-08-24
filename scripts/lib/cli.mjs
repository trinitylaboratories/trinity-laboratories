import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function parseArgs(argv) {
  const args = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;

    const separator = token.indexOf('=');
    if (separator !== -1) {
      args.set(token.slice(2, separator), token.slice(separator + 1));
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args.set(key, next);
      index += 1;
    } else {
      args.set(key, true);
    }
  }

  return args;
}

export function isMain(importMetaUrl) {
  if (!process.argv[1]) return false;
  return pathToFileURL(path.resolve(process.argv[1])).href === importMetaUrl;
}

export function requiredChoice(args, name, choices) {
  const value = args.get(name);
  if (typeof value !== 'string' || !choices.includes(value)) {
    throw new Error(`--${name} must be one of: ${choices.join(', ')}`);
  }
  return value;
}

export function optionalString(args, name, fallback) {
  const value = args.get(name);
  return typeof value === 'string' ? value : fallback;
}

export function printErrors(title, errors) {
  if (errors.length === 0) return;
  console.error(`\n${title}`);
  for (const error of errors) console.error(`  - ${error}`);
}
