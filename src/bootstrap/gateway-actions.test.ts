import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerPackage } from "@atom-neo/gateway";
import { upsertInstance } from "@atom-neo/shared";
import { createGatewayActions } from "./gateway-actions";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "atom-gateway-actions-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, ".atom"), { recursive: true });
  return dir;
}

function writeManifest(root: string, id = "echo-bot", platform = "test"): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "manifest.json"), JSON.stringify({
    manifest_version: 1,
    id,
    name: id,
    version: "1.0.0",
    platform,
    entry: { development: ["bun", "run", "src/main.ts"] },
    config: {
      mode: { label: "Mode", type: "string", enum: ["longpoll", "webhook"], default: "longpoll" },
      "bot-token": { label: "Bot Token", type: "string", required: true, secret: true, env: "ECHO_BOT_TOKEN" },
    },
  }));
}

describe("gateway action manifest bridge", () => {
  test("describes a config-only directory instance", async () => {
    const dir = sandbox();
    const clientRoot = join(dir, "client");
    writeManifest(clientRoot, "echo-bot", "telegram");
    upsertInstance(dir, {
      id: "dev",
      directory: clientRoot,
      clientArgs: { mode: "webhook" },
      stdio: "inherit",
    }, { "bot-token": "stored-secret" });

    const info = await createGatewayActions(dir).describe!("dev");

    expect(info.platform).toBe("telegram");
    expect(info.clientArgs).toEqual({ mode: "webhook" });
    expect(info.secretFields).toEqual(["bot-token"]);
    expect(info.config["bot-token"]).toMatchObject({ label: "Bot Token", required: true, secret: true });
    expect(JSON.stringify(info)).not.toContain("stored-secret");
  });

  test("describes a config-only package instance through the registry", async () => {
    const dir = sandbox();
    const target = `${process.platform}-${process.arch}`;
    const relative = `.atom/gateway/packages/echo-bot/1.0.0/${target}`;
    writeManifest(join(dir, relative), "echo-bot", "package-platform");
    registerPackage(dir, {
      id: "echo-bot",
      version: "1.0.0",
      target,
      path: relative,
      source: "test",
      sha256: "a".repeat(64),
    });
    upsertInstance(dir, {
      id: "installed",
      package: { id: "echo-bot", version: "1.0.0" },
      stdio: "ignore",
    });

    const info = await createGatewayActions(dir).describe!("installed");

    expect(info.platform).toBe("package-platform");
    expect(info.secretFields).toEqual([]);
    expect(info.config.mode).toMatchObject({ default: "longpoll" });
  });

  test("rejects an unknown instance", async () => {
    const dir = sandbox();
    await expect(createGatewayActions(dir).describe!("ghost")).rejects.toThrow("Unknown client instance: ghost");
  });
});
