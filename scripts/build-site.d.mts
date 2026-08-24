import type { LocalBuildPaths } from './lib/local-build-stage.mjs';

export interface BuildSiteOptions {
  env?: NodeJS.ProcessEnv;
  buildImplementation?: (options: Record<string, unknown>) => Promise<unknown>;
  root?: URL;
}

export interface BuildSiteResult {
  configFile: string | undefined;
  indexable: boolean;
  root: string;
}

export function inferIndexability(env?: NodeJS.ProcessEnv): boolean;
export function withLocalPrerenderCleanup<T>(
  paths: LocalBuildPaths,
  operation: () => Promise<T>,
): Promise<T>;
export function buildSite(options?: BuildSiteOptions): Promise<BuildSiteResult>;
