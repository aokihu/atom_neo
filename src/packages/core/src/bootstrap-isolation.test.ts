import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger } from "@atom-neo/shared";
import { createCoreBootstrap } from "./bootstrap";
import type { CoreBootstrap } from "./bootstrap";
import type { CoreServices } from "./core-services";
import type { RuntimeLike } from "./pipeline-factory";

const services: CoreServices = {
  memory: {
    search: async () => [],
    getById: () => null,
    save: () => "memory-1",
    traverse: () => [],
    link: () => false,
    forget: () => false,
    retain: () => {},
  },
  network: { webFetch: async () => ({ ok: true, code: "success", content: "" }) },
};

function makeRuntime(sandbox: string): RuntimeLike {
  return {
    sandbox,
    appConfig: {},
    maxTokens: 100,
    getResolvedModel: () => ({ provider: "local", model: "local", apiKey: "" }),
  };
}

function makeBootstrap(sandbox: string): CoreBootstrap {
  return createCoreBootstrap({
    port: 0,
    host: "127.0.0.1",
    logger: new Logger("error", () => {}),
    services,
    runtime: makeRuntime(sandbox),
    isStopping: () => false,
  });
}

async function stop(core: CoreBootstrap): Promise<void> {
  clearInterval(core.sessionSweepTimer);
  core.taskEngine.stop();
  core.scheduleService.stop();
  core.hookManager.stop();
  await core.backgroundShell.stop();
  core.mcp.stopHealth();
  core.contextService.stop();
  await core.mcp.close();
}

describe("Core bootstrap isolation", () => {
  test("two bootstraps own independent element registries, prompt resolvers and pipeline stores", async () => {
    const firstSandbox = mkdtempSync(join(tmpdir(), "atom-bootstrap-a-"));
    const secondSandbox = mkdtempSync(join(tmpdir(), "atom-bootstrap-b-"));
    const first = makeBootstrap(firstSandbox);
    const second = makeBootstrap(secondSandbox);
    try {
      expect(first.elementRegistry).not.toBe(second.elementRegistry);
      expect(first.pipelineStore).not.toBe(second.pipelineStore);
      expect(first.promptRegistry).not.toBe(second.promptRegistry);
      expect(first.promptResolver).not.toBe(second.promptResolver);
      expect(first.elementRegistry.names()).toEqual(second.elementRegistry.names());
      expect(first.elementRegistry.names().length).toBe(29);
      expect(new Set(first.elementRegistry.names()).size).toBe(29);
      expect(first.elementRegistry.names()).toContain("collect-prompts");
      expect(first.elementRegistry.names()).toContain("jev-decision");
      expect(first.elementRegistry.names()).toContain("compress-input");
    } finally {
      await stop(first);
      await stop(second);
      rmSync(firstSandbox, { recursive: true, force: true });
      rmSync(secondSandbox, { recursive: true, force: true });
    }
  });
});
