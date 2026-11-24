// Child tools and platform clients must not inherit TUI management credentials
// or credentials that belong to other client instances.
export const INSTANCE_CREDENTIAL_PREFIX = "ATOM_CLIENT_";

function isForbiddenChildEnvKey(key: string): boolean {
  return key === "ATOM_ADMIN_TOKEN" || key.startsWith(INSTANCE_CREDENTIAL_PREFIX);
}

function copyAllowedEnv(target: NodeJS.ProcessEnv, from: NodeJS.ProcessEnv): void {
  for (const [key, value] of Object.entries(from)) {
    if (!isForbiddenChildEnvKey(key)) target[key] = value;
  }
}

export function createChildProcessEnv(
  source: NodeJS.ProcessEnv = process.env,
  injected: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  copyAllowedEnv(env, source);
  copyAllowedEnv(env, injected);
  return env;
}
