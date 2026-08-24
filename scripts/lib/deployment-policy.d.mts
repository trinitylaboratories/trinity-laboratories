export const DEPLOYMENT_ENVIRONMENTS: readonly ['production', 'preview'];
export type DeploymentEnvironment = (typeof DEPLOYMENT_ENVIRONMENTS)[number];
export function assertDeploymentEnvironment(
  environment: string,
): asserts environment is DeploymentEnvironment;
export function extractInlineScriptHashes(html: string): string[];
export function buildContentSecurityPolicy(scriptHashes?: string[]): string;
export function buildHeaders(
  environment: DeploymentEnvironment,
  options?: { scriptHashes?: string[] },
): string;
export function buildRobots(environment: DeploymentEnvironment): string;
export function inferDeploymentEnvironment(env?: NodeJS.ProcessEnv): DeploymentEnvironment;
