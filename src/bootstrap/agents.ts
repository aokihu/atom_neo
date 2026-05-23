import { mkdirSync, existsSync } from "node:fs";
import agentsMdTemplate from "@assets/prompts/agents_md_sample.md";

export function initAtomDir(sandboxPath: string): void {
  const atomPath = `${sandboxPath}/.atom`;
  mkdirSync(atomPath, { recursive: true });
  mkdirSync(`${atomPath}/compiled_prompts`, { recursive: true });
}

export function initAgentsMd(sandboxPath: string): void {
  const agentsPath = `${sandboxPath}/AGENTS.md`;
  if (!existsSync(agentsPath)) {
    Bun.write(agentsPath, agentsMdTemplate);
  }
}
