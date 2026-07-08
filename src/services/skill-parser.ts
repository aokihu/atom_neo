export type SkillSectionMeta = {
  offset: number;
  length: number;
};

export type SkillDef = {
  name: string;
  description: string;
  capabilities: string[];
  version?: string;
  filePath: string;
  sections: Map<string, SkillSectionMeta>;
};

export interface SkillParser {
  parse(content: string, filePath: string): SkillDef;
}

export class MechanicalParser implements SkillParser {
  parse(content: string, filePath: string): SkillDef {
    const trimmed = content.trim();
    if (!trimmed) {
      return { name: "", description: "", capabilities: [], filePath, sections: new Map() };
    }

    const lines = trimmed.split("\n");
    const frontMatter = extractFrontMatter(lines);

    const name = (frontMatter.name as string) ?? "";
    const description = (frontMatter.description as string) ?? "";
    const version = frontMatter.version as string | undefined;
    let capabilities = Array.isArray(frontMatter.capabilities)
      ? (frontMatter.capabilities as string[])
      : [];

    const sections = new Map<string, SkillSectionMeta>();
    let currentSection: string | null = null;
    let sectionStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^## (\S.*)$/);
      if (match) {
        if (currentSection) {
          sections.set(currentSection, {
            offset: sectionStart + 1,
            length: i - sectionStart,
          });
        }
        currentSection = match[1].trim();
        sectionStart = i;
      }
    }

    if (currentSection) {
      sections.set(currentSection, {
        offset: sectionStart + 1,
        length: lines.length - sectionStart,
      });
    }

    if (sections.size === 0) {
      sections.set("default", { offset: 1, length: lines.length });
    }

    if (capabilities.length === 0) {
      capabilities = [...sections.keys()];
    }

    return { name, description, capabilities, version, filePath, sections };
  }
}

function extractFrontMatter(lines: string[]): Record<string, unknown> {
  if (lines[0]?.trim() !== "---") return {};

  const endIdx = lines.slice(1).findIndex(l => l.trim() === "---");
  if (endIdx === -1) return {};

  const raw = lines.slice(1, endIdx + 1).join("\n");
  const result: Record<string, unknown> = {};

  let key: string | null = null;
  for (const line of raw.split("\n")) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) {
      key = kv[1];
      const rawVal = kv[2].trim();
      const val = rawVal.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
      if (val) {
        result[key] = val;
      } else {
        result[key] = [];
      }
    } else if (key) {
      const item = line.match(/^\s*-\s+(.*)$/);
      if (item) {
        const arr = result[key] as string[];
        if (Array.isArray(arr)) arr.push(item[1].trim());
        else result[key] = [item[1].trim()];
      }
    }
  }

  return result;
}
