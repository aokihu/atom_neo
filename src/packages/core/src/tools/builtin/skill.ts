import { z } from "zod";
import type { ToolDefinition, ToolExecuteOptions } from "@atom-neo/shared";
import type { SkillServiceLike } from "../../skills/types";

export function createSkillTools(svc: SkillServiceLike): ToolDefinition[] {
  return [
    createSkillListTool(svc),
    createSkillLoadTool(svc),
    createSkillSectionTool(svc),
    createSkillRemoveSectionTool(svc),
    createSkillUnloadTool(svc),
  ];
}

function createSkillListTool(svc: SkillServiceLike): ToolDefinition {
  return {
    name: "skill_list",
    description: "List all available skills with their names, descriptions, and capabilities.",
    source: "builtin",
    inputSchema: z.object({}),
    execute: async () => {
      const list = svc.list();
      return { ok: true, output: JSON.stringify(list) };
    },
  };
}

function createSkillLoadTool(svc: SkillServiceLike): ToolDefinition {
  return {
    name: "skill_load",
    description: "Load a skill's full content into context. Returns all available section names.",
    source: "builtin",
    inputSchema: z.object({
      name: z.string().describe("Skill name"),
    }),
    execute: async (args: unknown, opts?: ToolExecuteOptions) => {
      const { name } = args as { name: string };
      const result = svc.load(name, opts?.sessionId);
      if (!result.ok) return { ok: false, output: result.error ?? "" };
      return {
        ok: true,
        output: `Loaded skill "${name}" with sections: ${result.sections?.join(", ")}`,
      };
    },
  };
}

function createSkillSectionTool(svc: SkillServiceLike): ToolDefinition {
  return {
    name: "skill_section",
    description: "Load a specific section of a skill into context. Use after skill_load.",
    source: "builtin",
    inputSchema: z.object({
      name: z.string().describe("Skill name"),
      section: z.string().describe("Section name"),
    }),
    execute: async (args: unknown, opts?: ToolExecuteOptions) => {
      const { name, section } = args as { name: string; section: string };
      const ok = svc.loadSection(name, section, opts?.sessionId);
      if (!ok) return { ok: false, output: `Section "${section}" not found in skill "${name}"` };
      return { ok: true, output: `Loaded section "${section}" from skill "${name}"` };
    },
  };
}

function createSkillRemoveSectionTool(svc: SkillServiceLike): ToolDefinition {
  return {
    name: "skill_remove_section",
    description: "Remove a section from context to free up context space when it is no longer needed.",
    source: "builtin",
    inputSchema: z.object({
      name: z.string().describe("Skill name"),
      section: z.string().describe("Section name"),
    }),
    execute: async (args: unknown, opts?: ToolExecuteOptions) => {
      const { name, section } = args as { name: string; section: string };
      const ok = svc.removeSection(name, section, opts?.sessionId);
      if (!ok) return { ok: false, output: `Section "${section}" not found in skill "${name}"` };
      return { ok: true, output: `Removed section "${section}" from skill "${name}"` };
    },
  };
}

function createSkillUnloadTool(svc: SkillServiceLike): ToolDefinition {
  return {
    name: "skill_unload",
    description: "Unload an entire skill and all its sections from context.",
    source: "builtin",
    inputSchema: z.object({
      name: z.string().describe("Skill name"),
    }),
    execute: async (args: unknown, opts?: ToolExecuteOptions) => {
      const { name } = args as { name: string };
      svc.unload(name, opts?.sessionId);
      return { ok: true, output: `Unloaded skill "${name}"` };
    },
  };
}
