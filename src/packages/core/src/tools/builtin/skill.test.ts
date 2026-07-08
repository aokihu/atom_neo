import { describe, test, expect, mock } from "bun:test";
import type { SkillServiceLike } from "../../skills/types";
import { createSkillTools } from "./skill";

function makeMockService(overrides?: Partial<SkillServiceLike>): SkillServiceLike {
  return {
    list: mock(() => [
      { name: "test", description: "desc", capabilities: ["a", "b"] },
    ]),
    load: mock((name: string) =>
      name === "test"
        ? { ok: true, sections: ["a", "b"] }
        : { ok: false, error: `Skill "${name}" not found` },
    ),
    loadSection: mock((_name: string, section: string) => section === "a"),
    removeSection: mock((_name: string, section: string) => section === "a"),
    unload: mock(() => {}),
    buildContext: mock(() => ""),
    ...overrides,
  };
}

describe("createSkillTools", () => {
  const tools = createSkillTools(makeMockService() as SkillServiceLike);

  test("skill_list returns all skills", async () => {
    const t = tools.find(x => x.name === "skill_list")!;
    const result = await t.execute({});
    expect(result.ok).toBe(true);
    const data = JSON.parse(result.output);
    expect(data).toEqual([{ name: "test", description: "desc", capabilities: ["a", "b"] }]);
  });

  test("skill_load loads skill successfully", async () => {
    const t = tools.find(x => x.name === "skill_load")!;
    const result = await t.execute({ name: "test" });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("test");
    expect(result.output).toContain("a, b");
  });

  test("skill_load returns error for unknown skill", async () => {
    const svc = makeMockService();
    const t = createSkillTools(svc as SkillServiceLike).find(x => x.name === "skill_load")!;
    const result = await t.execute({ name: "unknown" });
    expect(result.ok).toBe(false);
  });

  test("skill_section loads section successfully", async () => {
    const t = tools.find(x => x.name === "skill_section")!;
    const result = await t.execute({ name: "test", section: "a" });
    expect(result.ok).toBe(true);
  });

  test("skill_section returns error for unknown section", async () => {
    const t = tools.find(x => x.name === "skill_section")!;
    const result = await t.execute({ name: "test", section: "b" });
    expect(result.ok).toBe(false);
  });

  test("skill_remove_section removes section", async () => {
    const t = tools.find(x => x.name === "skill_remove_section")!;
    const result = await t.execute({ name: "test", section: "a" });
    expect(result.ok).toBe(true);
  });

  test("skill_remove_section returns error for unknown section", async () => {
    const t = tools.find(x => x.name === "skill_remove_section")!;
    const result = await t.execute({ name: "test", section: "b" });
    expect(result.ok).toBe(false);
  });

  test("skill_unload unloads skill", async () => {
    const t = tools.find(x => x.name === "skill_unload")!;
    const result = await t.execute({ name: "test" });
    expect(result.ok).toBe(true);
  });

  test("skill_unload succeeds even if skill was not loaded", async () => {
    const t = tools.find(x => x.name === "skill_unload")!;
    const result = await t.execute({ name: "test" });
    expect(result.ok).toBe(true);
  });

  test("all tools have required fields", () => {
    expect(tools.length).toBe(5);
    for (const tool of tools) {
      expect(tool.name).toBeString();
      expect(tool.description).toBeString();
      expect(tool.source).toBe("builtin");
      expect(tool.inputSchema).toBeObject();
      expect(tool.execute).toBeFunction();
    }
  });
});
