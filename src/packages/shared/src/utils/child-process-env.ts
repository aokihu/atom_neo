// Child tools and platform clients must not inherit TUI management credentials.
export function createChildProcessEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...source };
  delete env.ATOM_ADMIN_TOKEN;
  return env;
}
