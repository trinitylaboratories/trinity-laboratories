import type { ExecFileOptionsWithStringEncoding, execFile } from 'node:child_process';

export interface RepositoryState {
  branch: string;
  clean: boolean;
  head: string;
}

export interface DeploymentCommand {
  args: string[];
  environment: 'production' | 'preview';
}

export interface GitStateOptions {
  cwd?: string;
  execFileImplementation?: (
    file: string,
    args: readonly string[],
    options: ExecFileOptionsWithStringEncoding,
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) => ReturnType<typeof execFile>;
}

export function previewAlias(branch?: string): string;
export function deploymentCommand(
  env?: NodeJS.ProcessEnv,
  repositoryState?: RepositoryState,
): DeploymentCommand;
export function readGitDeploymentState(options?: GitStateOptions): Promise<RepositoryState>;
export function resolveDeploymentCommand(
  env?: NodeJS.ProcessEnv,
  options?: GitStateOptions,
): Promise<DeploymentCommand>;
export function deploySite(
  env?: NodeJS.ProcessEnv,
  options?: GitStateOptions,
): Promise<DeploymentCommand>;
