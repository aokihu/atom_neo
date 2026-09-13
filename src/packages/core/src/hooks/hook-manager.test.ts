import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { BusEvents, PipelineEventBus, PipelineResultType, TaskSource } from "@atom-neo/shared";
import type { FullEventMap } from "@atom-neo/shared";
import { createTaskItem } from "../task-factory";
import { HookManager } from "./hook-manager";
import { ScheduleService } from "../tools/schedule-service";
import { TaskQueue } from "../task-queue";

const roots: string[] = [];
const cleanup: (() => void)[] = [];

afterEach(() => {
  for (const stop of cleanup.splice(0)) stop();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function runtime() {
  const root = mkdtempSync(resolve(tmpdir(), "atom-hook-time-"));
  roots.push(root);
  const path = resolve(root, "hooks.json");
  const queue = new TaskQueue();
  const bus = new PipelineEventBus<FullEventMap>();
  const logger = { info() {}, warn() {}, error() {}, debug() {} } as any;
  const service = new ScheduleService(queue, resolve(root, "schedule.json"), logger);
  const manager = new HookManager(service, bus, queue, path, logger);
  cleanup.push(() => { manager.stop(); service.stop(); });
  return { manager, service, queue, bus, path };
}

test("restoration skips expired delay, retains future deadline and advances interval without catch-up", async () => {
  const { manager, service, queue, path } = runtime();
  const now = Date.now();
  const base = { name: "timer", scope: "global", sessionId: "saved", prompt: "work", enabled: true, createdAt: now - 5000, updatedAt: now - 5000 };
  writeFileSync(path, JSON.stringify([
    { ...base, id: "expired", trigger: { type: "time:delay", delayMs: 100 } },
    { ...base, id: "future", trigger: { type: "time:delay", delayMs: 10000 }, nextFireAt: now + 1000 },
    { ...base, id: "interval", trigger: { type: "time:interval", intervalMs: 1000 }, nextFireAt: now - 1500 },
    { ...base, id: "done", trigger: { type: "time:delay", delayMs: 10000 }, lastFiredAt: now - 1 },
    { ...base, id: "session", scope: "session", trigger: { type: "time:delay", delayMs: 10000 } },
    { ...base, id: "cron", trigger: { type: "time:cron", schedule: "0 0 * * *" }, nextFireAt: now - 1000 },
  ]));
  manager.restore();
  expect(manager.get("expired")?.enabled).toBe(false);
  expect(manager.get("expired")?.expiredAt).toBeGreaterThanOrEqual(now);
  expect(manager.get("future")?.nextFireAt).toBe(now + 1000);
  expect(manager.get("interval")?.nextFireAt).toBe(now + 500);
  expect(manager.get("cron")?.nextFireAt).toBeGreaterThan(now);
  expect(manager.get("done")?.enabled).toBe(false);
  expect(manager.get("session")).toBeUndefined();
  manager.restore();
  expect(service.list()).toHaveLength(4);
  await Bun.sleep(30);
  expect(queue.size).toBe(0);
  expect(JSON.parse(readFileSync(path, "utf8")).find((h: any) => h.id === "expired").enabled).toBe(false);
});

test("global time tasks use saved session, complete once, and persist completion", async () => {
  const { manager, service, queue, bus, path } = runtime();
  const hook = manager.create({ name: "once", scope: "global", sessionId: "saved", trigger: { type: "time:delay", delayMs: 20 }, prompt: "work" });
  bus.emit(BusEvents.Session.Started, { sessionId: "unrelated" });
  await Bun.sleep(60);
  expect(queue.dequeue()?.sessionId).toBe("saved");
  expect(hook.enabled).toBe(false);
  expect(hook.lastFiredAt).toBeDefined();
  expect(hook.nextFireAt).toBeUndefined();
  const restored = new HookManager(service, bus, queue, path, { info() {}, warn() {} } as any);
  cleanup.push(() => restored.stop());
  restored.restore();
  await Bun.sleep(30);
  expect(queue.size).toBe(0);
});

test("stop blocks timers and retained callbacks, and rejects new schedules", async () => {
  const { manager, service, queue } = runtime();
  manager.create({ name: "repeat", scope: "global", trigger: { type: "time:interval", intervalMs: 20 }, prompt: "work" });
  const scheduled = service.list()[0];
  manager.stop();
  scheduled.onFire?.(scheduled);
  await Bun.sleep(50);
  expect(queue.size).toBe(0);
  expect(() => manager.create({ name: "late", trigger: { type: "time:delay", delayMs: 1 }, prompt: "late" })).toThrow("stopped");
});

test("global schedules without an owner retain a stable internal session", async () => {
  const { manager, queue } = runtime();
  const hook = manager.create({ name: "internal", scope: "global", trigger: { type: "time:delay", delayMs: 20 }, prompt: "work" });
  expect(hook.sessionId).toBeDefined();
  await Bun.sleep(60);
  expect(queue.dequeue()?.sessionId).toBe(hook.sessionId);
});

describe("HookManager", () => {
  test("does not re-enter task-completed hooks from a Hook-origin task chain", () => {
    const root = mkdtempSync(resolve(tmpdir(), "atom-hook-"));
    roots.push(root);
    const bus = new PipelineEventBus<FullEventMap>();
    const tasks: any[] = [];
    const manager = new HookManager(
      { create: () => ({ id: "schedule" }), cancel: () => true } as any,
      bus,
      { enqueue: (task: any) => tasks.push(task) } as any,
      resolve(root, "hooks.json"),
      { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any,
    );
    manager.create({
      name: "after task",
      scope: "session",
      sessionId: "s1",
      trigger: { type: "task:completed" },
      prompt: "review",
    });
    const external = createTaskItem({
      sessionId: "s1",
      chatId: "c1",
      pipeline: "conversation",
      source: TaskSource.EXTERNAL,
      payload: [],
    });
    const result = { type: PipelineResultType.Complete, task: external } as const;

    bus.emit(BusEvents.Task.Committed, { task: external, result });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].origin?.type).toBe("hook");

    bus.emit(BusEvents.Task.Committed, {
      task: tasks[0],
      result: { type: PipelineResultType.Complete, task: tasks[0] },
    });
    expect(tasks).toHaveLength(1);
  });

  test("does not fire event hooks after stop", () => {
    const root = mkdtempSync(resolve(tmpdir(), "atom-hook-stop-"));
    roots.push(root);
    const bus = new PipelineEventBus<FullEventMap>();
    const tasks: any[] = [];
    const manager = new HookManager(
      { create: () => ({ id: "schedule" }), cancel: () => true } as any,
      bus,
      { enqueue: (task: any) => tasks.push(task) } as any,
      resolve(root, "hooks.json"),
      { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any,
    );
    manager.create({
      name: "session end",
      scope: "session",
      sessionId: "s1",
      trigger: { type: "session:end" },
      prompt: "cleanup",
    });

    manager.stop();
    bus.emit(BusEvents.Session.Closed, { sessionId: "s1" });
    expect(tasks).toHaveLength(0);
  });
});
