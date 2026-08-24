export const LOCAL_BUILD_STAGE: '.tools/build-dist';
export interface LocalBuildPaths {
  readonly root: string;
  readonly tools: string;
  readonly stage: string;
  readonly backup: string;
  readonly dist: string;
}
export function resolveLocalBuildPaths(
  projectRoot: string,
  requestedStage?: string,
): Promise<LocalBuildPaths>;
export function prepareLocalBuildStage(
  paths: LocalBuildPaths,
  options?: { platform?: NodeJS.Platform },
): Promise<void>;
export function discardLocalBuildStage(paths: LocalBuildPaths): Promise<void>;
export function publishLocalBuild(
  paths: LocalBuildPaths,
  options?: {
    renamePath?: (source: string, destination: string) => Promise<void>;
    copyPath?: (
      source: string,
      destination: string,
      options: {
        recursive: true;
        force: false;
        errorOnExist: true;
        preserveTimestamps: true;
      },
    ) => Promise<void>;
    platform?: NodeJS.Platform;
    onCleanupWarning?: (error: Error) => void;
  },
): Promise<void>;
