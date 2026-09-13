import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PipelineEventBus } from "@atom-neo/shared";
import { ContextService } from "../context/context-service";
import { SessionPersistenceService } from "./persistence-service";
import { SessionStore } from "./store";

const roots: string[] = [];
const contexts: ContextService[] = [];
function setup(root = mkdtempSync(join(tmpdir(), "atom-initiator-test-"))) {
  roots.push(root);
  const context = new ContextService(new PipelineEventBus(), { sweepIntervalMs: 0 });
  contexts.push(context);
  context.start();
  const persistence = new SessionPersistenceService(root, context);
  return { root, persistence, store: new SessionStore(1000, undefined, undefined, persistence) };
}
afterEach(() => { for (const context of contexts.splice(0)) context.stop(); for (const root of new Set(roots.splice(0))) rmSync(root, { recursive: true, force: true }); });

test("initiator survives checkpoint, restore and later internal access", () => {
  const first = setup();
  const origin = { type: "gateway" as const, clientId: "bot", platform: "telegram" };
  first.store.get("opaque-id", origin);
  expect(first.store.save("opaque-id", "message")).toBe(true);
  const second = setup(first.root);
  expect(second.store.get("opaque-id", { type: "internal" }).initiator).toEqual(origin);
});

test("legacy TUI-looking ID restores as unknown and is not selected for attach", () => {
  const first = setup();
  first.store.get("tui-legacy", { type: "tui" });
  first.store.save("tui-legacy", "message");
  const file = join(first.persistence.getSessionDirectory("tui-legacy"), "current/session.json");
  const state = JSON.parse(readFileSync(file, "utf8"));
  delete state.initiator;
  writeFileSync(file, JSON.stringify(state));
  const second = setup(first.root);
  expect(second.store.get("tui-legacy").initiator).toEqual({ type: "unknown" });
  expect(second.store.attachTui().sessionId).not.toBe("tui-legacy");
});

test("latest explicit TUI metadata wins over IDs, internal access and Gateway activity", () => {
  const first = setup();
  const old = first.store.get("a", { type: "tui" }); old.lastTuiUsedAt = 1;
  const latest = first.store.get("z", { type: "tui" }); latest.lastTuiUsedAt = 2;
  first.store.save("a", "message"); first.store.save("z", "message");
  const gateway = first.store.get("tui-fake", { type: "gateway", clientId: "bot", platform: "telegram" }); gateway.lastTuiUsedAt = 100;
  first.store.save(gateway.sessionId, "message");
  const second = setup(first.root);
  second.store.get("a"); second.store.get("tui-fake");
  expect(second.store.attachTui().sessionId).toBe("z");
  expect(second.store.attachTui().sessionId).toBe("z");
});
