import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { TaskItem } from "@atom-neo/shared";
import { SessionContext } from "./context";
import type { ElementTask, PipelineSession } from "./element-session";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("Element boundary types", () => {
  test("SessionContext satisfies PipelineSession", () => {
    const session: PipelineSession = new SessionContext("x");
    expect(session.sessionId).toBe("x");
  });

  test("missing required session fields fail at compile time", () => {
    // @ts-expect-error PipelineSession requires messages, todoState, currentTopic, and methods.
    const invalid: PipelineSession = { sessionId: "missing" };
    expect(invalid.sessionId).toBe("missing");
  });

  test("ElementTask remains TaskItem", () => {
    const task = {} as TaskItem;
    const elementTask: ElementTask = task;
    const roundTrip: TaskItem = elementTask;
    expect(roundTrip).toBe(task);
  });

  test("pipelines production code has no broad session/task/memory annotations", () => {
    const pattern = /\b(?:session|task|memory)\??\s*:\s*any\b/g;
    const offenders = sourceFiles(resolve(import.meta.dir, "../pipelines")).flatMap(path => {
      const matches = [...readFileSync(path, "utf8").matchAll(pattern)];
      return matches.map(match => `${path}:${match[0]}`);
    });
    expect(offenders).toEqual([]);
  });
});
