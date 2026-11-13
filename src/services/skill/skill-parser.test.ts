import { describe, test, expect } from "bun:test";
import { MechanicalParser, type SkillParser } from "./skill-parser";

const SAMPLE = `---
name: remote-server-setup
description: SSH, firewall, nginx, docker setup
capabilities:
  - ssh-login
  - firewall-setup
  - nginx-config
  - docker-install
version: "1.0"
---

## ssh-login

ssh user@host -p 22

uname -a

## firewall-setup

ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

## nginx-config

apt update && apt install -y nginx

vim /etc/nginx/sites-available/default

systemctl restart nginx

## docker-install

curl -fsSL https://get.docker.com | sh
usermod -aG docker $USER
`;

const NO_SECTIONS = `---
name: simple-skill
description: A skill without sections
capabilities:
  - main
---

This is just plain text without any sections.
`;

const NO_CAPABILITIES = `---
name: auto-skill
description: Capabilities auto-generated from sections
---

## setup

Run the setup command.

## deploy

Deploy the application.
`;

describe("MechanicalParser", () => {
  let parser: SkillParser;

  test("parses valid SKILL.md with YAML + sections", () => {
    parser = new MechanicalParser();
    const result = parser.parse(SAMPLE, "/tmp/skills/test/SKILL.md");

    expect(result.name).toBe("remote-server-setup");
    expect(result.description).toBe("SSH, firewall, nginx, docker setup");
    expect(result.version).toBe("1.0");
    expect(result.capabilities).toEqual(["ssh-login", "firewall-setup", "nginx-config", "docker-install"]);
    expect(result.filePath).toBe("/tmp/skills/test/SKILL.md");
    expect(result.sections.size).toBe(4);

    const ssh = result.sections.get("ssh-login");
    expect(ssh).toBeDefined();
    expect(ssh!.length).toBeGreaterThan(0);
    expect(ssh!.offset).toBeGreaterThan(0);

    const docker = result.sections.get("docker-install");
    expect(docker).toBeDefined();
    expect(docker!.length).toBeGreaterThan(0);
    expect(docker!.offset).toBeGreaterThan(0);
  });

  test("returns single default section when no ## headers", () => {
    parser = new MechanicalParser();
    const result = parser.parse(NO_SECTIONS, "/tmp/skills/simple/SKILL.md");

    expect(result.name).toBe("simple-skill");
    expect(result.capabilities).toEqual(["main"]);
    expect(result.sections.size).toBe(1);

    const def = result.sections.get("default");
    expect(def).toBeDefined();
    expect(def!.length).toBeGreaterThan(0);
  });

  test("generates capabilities from sections when YAML missing capabilities", () => {
    parser = new MechanicalParser();
    const result = parser.parse(NO_CAPABILITIES, "/tmp/skills/auto/SKILL.md");

    expect(result.name).toBe("auto-skill");
    expect(result.capabilities).toEqual(["setup", "deploy"]);
    expect(result.sections.size).toBe(2);

    const setup = result.sections.get("setup");
    expect(setup).toBeDefined();

    const deploy = result.sections.get("deploy");
    expect(deploy).toBeDefined();
  });

  test("parses version from YAML frontmatter", () => {
    parser = new MechanicalParser();
    const result = parser.parse(SAMPLE, "/tmp/skills/test/SKILL.md");

    expect(result.version).toBe("1.0");
  });

  test("handles empty SKILL.md gracefully", () => {
    parser = new MechanicalParser();
    const result = parser.parse("", "/tmp/skills/empty/SKILL.md");

    expect(result.name).toBe("");
    expect(result.capabilities).toEqual([]);
    expect(result.sections.size).toBe(0);
  });
});
