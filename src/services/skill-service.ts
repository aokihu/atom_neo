import { BaseService } from "./base-service";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MechanicalParser } from "./skill-parser";
import type { SkillParser, SkillDef } from "./skill-parser";

export type SkillListItem = {
  name: string;
  description: string;
  capabilities: string[];
};

export type SkillLoadResult = {
  ok: boolean;
  sections?: string[];
  error?: string;
};

export class SkillService extends BaseService {
  readonly name = "skill";

  #sandbox: string;
  #parser: SkillParser;
  #skillDefs = new Map<string, SkillDef>();
  #activeSections = new Map<string, Set<string>>();

  constructor(params: { sandbox: string; parser?: SkillParser }) {
    super();
    this.#sandbox = params.sandbox;
    this.#parser = params.parser ?? new MechanicalParser();
  }

  async start(): Promise<void> {
    await super.start();
    const dir = join(this.#sandbox, ".atom", "skills");
    if (!existsSync(dir)) return;

    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = join(dir, entry.name, "SKILL.md");
      if (!existsSync(skillPath)) continue;
      const content = readFileSync(skillPath, "utf-8");
      const def = this.#parser.parse(content, skillPath);
      this.#skillDefs.set(def.name || entry.name, def);
    }
  }

  async stop(): Promise<void> {
    this.#skillDefs.clear();
    this.#activeSections.clear();
    await super.stop();
  }

  list(): SkillListItem[] {
    const items: SkillListItem[] = [];
    for (const def of this.#skillDefs.values()) {
      items.push({
        name: def.name,
        description: def.description,
        capabilities: def.capabilities,
      });
    }
    return items;
  }

  load(name: string): SkillLoadResult {
    const def = this.#skillDefs.get(name);
    if (!def) return { ok: false, error: `Skill "${name}" not found` };

    const sectionNames = [...def.sections.keys()];
    this.#activeSections.set(name, new Set(sectionNames));

    return { ok: true, sections: sectionNames };
  }

  loadSection(name: string, section: string): boolean {
    const def = this.#skillDefs.get(name);
    if (!def || !def.sections.has(section)) return false;

    if (!this.#activeSections.has(name)) {
      this.#activeSections.set(name, new Set());
    }
    this.#activeSections.get(name)!.add(section);
    return true;
  }

  removeSection(name: string, section: string): boolean {
    const set = this.#activeSections.get(name);
    if (!set || !set.has(section)) return false;

    set.delete(section);
    if (set.size === 0) {
      this.#activeSections.delete(name);
    }
    return true;
  }

  unload(name: string): void {
    this.#activeSections.delete(name);
  }

  buildContext(): string {
    const blocks: string[] = [];

    for (const [skillName, activeSet] of this.#activeSections) {
      if (activeSet.size === 0) continue;
      const def = this.#skillDefs.get(skillName);
      if (!def) continue;

      const content = readFileSync(def.filePath, "utf-8");
      const lines = content.split("\n");
      const sectionBlocks: string[] = [];

      for (const sectionName of activeSet) {
        const meta = def.sections.get(sectionName);
        if (!meta) continue;
        const snippet = lines.slice(meta.offset - 1, meta.offset - 1 + meta.length).join("\n");
        sectionBlocks.push(`  <section name="${sectionName}">\n${snippet.trim()}\n  </section>`);
      }

      if (sectionBlocks.length > 0) {
        blocks.push(`<skill name="${skillName}">\n${sectionBlocks.join("\n")}\n</skill>`);
      }
    }

    return blocks.join("\n");
  }
}
