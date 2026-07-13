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
  #activeSections = new Map<string, Map<string, Set<string>>>();
  #scopeRevisions = new Map<string, number>();

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
    this.#scopeRevisions.clear();
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

  load(name: string, sessionId = "default"): SkillLoadResult {
    const def = this.#skillDefs.get(name);
    if (!def) return { ok: false, error: `Skill "${name}" not found` };

    const sectionNames = [...def.sections.keys()];
    const scope = this.#scope(sessionId);
    const active = scope.get(name);
    if (!active || active.size !== sectionNames.length || sectionNames.some(section => !active.has(section))) {
      scope.set(name, new Set(sectionNames));
      this.#touch(sessionId);
    }

    return { ok: true, sections: sectionNames };
  }

  loadSection(name: string, section: string, sessionId = "default"): boolean {
    const def = this.#skillDefs.get(name);
    if (!def || !def.sections.has(section)) return false;

    const scope = this.#scope(sessionId);
    if (!scope.has(name)) {
      scope.set(name, new Set());
    }
    const added = !scope.get(name)!.has(section);
    scope.get(name)!.add(section);
    if (added) this.#touch(sessionId);
    return true;
  }

  removeSection(name: string, section: string, sessionId = "default"): boolean {
    const scope = this.#activeSections.get(sessionId);
    const set = scope?.get(name);
    if (!set || !set.has(section)) return false;

    set.delete(section);
    if (set.size === 0) {
      scope!.delete(name);
    }
    if (scope?.size === 0) this.#activeSections.delete(sessionId);
    this.#touch(sessionId);
    return true;
  }

  unload(name: string, sessionId = "default"): void {
    const scope = this.#activeSections.get(sessionId);
    if (!scope?.delete(name)) return;
    if (scope.size === 0) this.#activeSections.delete(sessionId);
    this.#touch(sessionId);
  }

  buildContext(sessionId = "default"): string {
    const blocks: string[] = [];

    for (const [skillName, activeSet] of this.#activeSections.get(sessionId) ?? []) {
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

  clearScope(sessionId: string): void {
    if (!this.#activeSections.delete(sessionId)) return;
    this.#touch(sessionId);
  }

  getRevision(sessionId = "default"): number {
    return this.#scopeRevisions.get(sessionId) ?? 0;
  }

  #scope(sessionId: string): Map<string, Set<string>> {
    let scope = this.#activeSections.get(sessionId);
    if (!scope) {
      scope = new Map();
      this.#activeSections.set(sessionId, scope);
    }
    return scope;
  }

  #touch(sessionId: string): void {
    this.#scopeRevisions.set(sessionId, this.getRevision(sessionId) + 1);
  }
}
