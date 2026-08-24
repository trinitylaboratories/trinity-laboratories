export interface InstallAttemptResult {
  code: number | null;
  output: string;
  signal: NodeJS.Signals | null;
}

export interface InstallResult extends InstallAttemptResult {
  attempts: number;
}

export function resolveNpmCli(
  npmExecPath?: string,
  options?: {
    platform?: NodeJS.Platform;
    execPath?: string;
    projectRoot?: string;
  },
): Promise<string>;
export function runNpmCiAttempt(options: {
  npmCli: string;
  spawnImplementation?: typeof import('node:child_process').spawn;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}): Promise<InstallAttemptResult>;
export function retryLockedInstall(options: {
  runAttempt: (attempt: number) => Promise<InstallAttemptResult>;
  waitImplementation?: (milliseconds: number) => Promise<void>;
  reportRetry?: (message: string) => void;
  maxAttempts?: number;
}): Promise<InstallResult>;
export function installLocked(): Promise<InstallResult>;
