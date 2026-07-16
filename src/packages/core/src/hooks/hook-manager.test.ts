import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { BusEvents, PipelineEventBus, PipelineResultType, TaskSource } from "@atom-neo/shared";
import type { FullEventMap } from "@atom-neo/shared";
import { createTaskItem } from "../task-factory";
import { HookManager } from "./hook-manager";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
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
