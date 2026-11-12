import { describe, test, expect } from "bun:test";
import { PipelineInstanceStore } from "./instance-store";
import type { Pipeline } from "./builder";

const makePipeline = (name: string): Pipeline => ({ name, elements: [] });

describe("PipelineInstanceStore", () => {
  test("sets, gets, overwrites and deletes a pipeline", () => {
    const store = new PipelineInstanceStore();
    const first = makePipeline("first");
    const second = makePipeline("second");

    expect(store.get("task-1")).toBeUndefined();
    store.set("task-1", first);
    expect(store.get("task-1")).toBe(first);
    store.set("task-1", second);
    expect(store.get("task-1")).toBe(second);
    expect(store.size).toBe(1);

    store.delete("task-1");
    expect(store.get("task-1")).toBeUndefined();
    expect(store.size).toBe(0);
  });

  test("clear removes every entry", () => {
    const store = new PipelineInstanceStore();
    store.set("task-1", makePipeline("one"));
    store.set("task-2", makePipeline("two"));
    store.clear();
    expect(store.size).toBe(0);
    expect(store.get("task-1")).toBeUndefined();
  });

  test("two stores do not share entries for the same task id", () => {
    const first = new PipelineInstanceStore();
    const second = new PipelineInstanceStore();
    const firstPipeline = makePipeline("first");
    const secondPipeline = makePipeline("second");

    first.set("shared-task", firstPipeline);
    second.set("shared-task", secondPipeline);

    expect(first.get("shared-task")).toBe(firstPipeline);
    expect(second.get("shared-task")).toBe(secondPipeline);
    expect(first.size).toBe(1);
    expect(second.size).toBe(1);

    first.delete("shared-task");
    expect(first.size).toBe(0);
    expect(second.get("shared-task")).toBe(secondPipeline);
  });
});
