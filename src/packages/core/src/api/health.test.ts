import { describe, test, expect } from "bun:test";
import { healthHandler, metricsHandler } from "./health";
import { TaskQueue } from "../task-queue";

describe("healthHandler", () => {
  test("returns ok status", async () => {
    const q = new TaskQueue();
    const res = healthHandler(q);
    const body: any = await res.json();
    expect(body.status).toBe("ok");
    expect(body.queue.waiting).toBe(0);
    expect(body.queue.processing).toBe(0);
  });
});

describe("metricsHandler", () => {
  test("returns memory usage", async () => {
    const q = new TaskQueue();
    const res = metricsHandler(q);
    const body: any = await res.json();
    expect(body.memory).toBeDefined();
    expect(body.queue).toBeDefined();
  });
});
