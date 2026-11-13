import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import agentsMdTemplate from "@assets/prompts/agents_md_sample.md";

export function initAtomDir(sandboxPath: string): void {
  const atomPath = `${sandboxPath}/.atom`;
  mkdirSync(atomPath, { recursive: true });
  mkdirSync(`${atomPath}/compiled_prompts`, { recursive: true });
  mkdirSync(`${atomPath}/memory/nodes`, { recursive: true });
}

export function initAgentsMd(sandboxPath: string): void {
  const agentsPath = `${sandboxPath}/AGENTS.md`;
  if (!existsSync(agentsPath)) {
    mkdirSync(dirname(agentsPath), { recursive: true });
    writeFileSync(agentsPath, agentsMdTemplate, "utf8");
  }
}
