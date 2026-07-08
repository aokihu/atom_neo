import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SkillService } from "./skill-service";

const SKILL_CONTENT = `---
name: test-skill
description: A test skill for unit tests
capabilities:
  - ssh
  - firewall
  - deploy
---

## ssh

ssh user@host -p 22

## firewall

ufw allow 80/tcp

## deploy

rsync -avz ./dist user@host:/var/www
`;

describe("SkillService", () => {
  let tmpDir: string;
  let svc: SkillService;

  beforeEach(() => {
    tmpDir = mkdtempSync("/tmp/atom-skill-test-");
    const skillsDir = join(tmpDir, ".atom", "skills", "test-skill");
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, "SKILL.md"), SKILL_CONTENT);
    svc = new SkillService({ sandbox: tmpDir });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("start() scans skill directory and populates cache", async () => {
    await svc.start();
    const list = svc.list();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe("test-skill");
    expect(list[0].description).toBe("A test skill for unit tests");
    expect(list[0].capabilities).toEqual(["ssh", "firewall", "deploy"]);
  });

  test("start() handles missing skill directory", async () => {
    const emptySvc = new SkillService({ sandbox: "/nonexistent/path" });
    await emptySvc.start();
    const list = emptySvc.list();
    expect(list).toEqual([]);
  });

  test("list() returns all skills", async () => {
    await svc.start();
    const list = svc.list();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe("test-skill");
  });

  test("load() activates all sections and returns section names", async () => {
    await svc.start();
    const result = svc.load("test-skill");
    expect(result.ok).toBe(true);
    expect(result.sections).toContain("ssh");
    expect(result.sections).toContain("firewall");
    expect(result.sections).toContain("deploy");
  });

  test("load() fails on unknown skill name", async () => {
    await svc.start();
    const result = svc.load("unknown-skill");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("unknown-skill");
  });

  test("load() is idempotent", async () => {
    await svc.start();
    svc.load("test-skill");
    const { sections } = svc.load("test-skill");
    expect(sections).toEqual(["ssh", "firewall", "deploy"]);
  });

  test("loadSection() activates a single section", async () => {
    await svc.start();
    svc.load("test-skill");
    const ok = svc.loadSection("test-skill", "ssh");
    expect(ok).toBe(true);
    const ctx = svc.buildContext();
    expect(ctx).toContain("ssh");
    expect(ctx).toContain("ssh user@host -p 22");
  });

  test("loadSection() auto-calls load() when skill is not yet loaded", async () => {
    await svc.start();
    const ok = svc.loadSection("test-skill", "firewall");
    expect(ok).toBe(true);
    const ctx = svc.buildContext();
    expect(ctx).toContain("firewall");
  });

  test("loadSection() fails on unknown section", async () => {
    await svc.start();
    svc.load("test-skill");
    const ok = svc.loadSection("test-skill", "nonexistent");
    expect(ok).toBe(false);
  });

  test("removeSection() removes section from context", async () => {
    await svc.start();
    svc.load("test-skill");
    svc.removeSection("test-skill", "ssh");
    const ctx = svc.buildContext();
    expect(ctx).not.toContain("<section name=\"ssh\">");
    expect(ctx).toContain("firewall");
    expect(ctx).toContain("deploy");
  });

  test("removeSection() cascades skill unload when last section removed", async () => {
    await svc.start();
    svc.load("test-skill");
    svc.removeSection("test-skill", "ssh");
    svc.removeSection("test-skill", "firewall");
    svc.removeSection("test-skill", "deploy");
    const ctx = svc.buildContext();
    expect(ctx).toBe("");
  });

  test("unload() removes entire skill", async () => {
    await svc.start();
    svc.load("test-skill");
    svc.unload("test-skill");
    const ctx = svc.buildContext();
    expect(ctx).toBe("");
  });

  test("buildContext() returns empty string when no sections are active", async () => {
    await svc.start();
    const ctx = svc.buildContext();
    expect(ctx).toBe("");
  });

  test("buildContext() generates correct nested XML", async () => {
    await svc.start();
    svc.load("test-skill");
    svc.removeSection("test-skill", "deploy");

    const ctx = svc.buildContext();

    expect(ctx).toContain("<skill name=\"test-skill\">");
    expect(ctx).toContain("</skill>");
    expect(ctx).toContain("<section name=\"ssh\">");
    expect(ctx).toContain("</section>");
    expect(ctx).toContain("<section name=\"firewall\">");
    expect(ctx).toContain("ufw allow 80/tcp");
    expect(ctx).not.toContain("<section name=\"deploy\">");
  });

  test("stop() clears all state", async () => {
    await svc.start();
    svc.load("test-skill");

    await svc.stop();

    const list = svc.list();
    expect(list).toEqual([]);
    const ctx = svc.buildContext();
    expect(ctx).toBe("");
  });
});
