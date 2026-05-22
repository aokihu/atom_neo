import { describe, test, expect } from "bun:test";
import { PipelineRecorder } from "./recorder";

describe("PipelineRecorder", () => {
  test("does not record when disabled", () => {
    const r = new PipelineRecorder();
    r.startTask("t1");
    r.record("t1", { type: "test", ts: 0, payload: {} });
    expect(r.getEvents("t1").length).toBe(0);
  });

  test("records events when enabled", () => {
    const r = new PipelineRecorder({ enabled: true });
    r.startTask("t1");
    r.record("t1", { type: "element.started", ts: 1, payload: { name: "e1" } });
    r.record("t1", { type: "element.finished", ts: 2, payload: { name: "e1" } });
    expect(r.getEvents("t1").length).toBe(2);
  });

  test("respects maxEvents limit", () => {
    const r = new PipelineRecorder({ enabled: true, maxEvents: 2 });
    r.startTask("t1");
    r.record("t1", { type: "a", ts: 0, payload: {} });
    r.record("t1", { type: "b", ts: 1, payload: {} });
    r.record("t1", { type: "c", ts: 2, payload: {} });
    expect(r.getEvents("t1").length).toBe(2);
  });

  test("ignores events for unstarted task", () => {
    const r = new PipelineRecorder({ enabled: true });
    r.record("unknown", { type: "x", ts: 0, payload: {} });
    expect(r.getEvents("unknown").length).toBe(0);
  });

  test("clears all events", () => {
    const r = new PipelineRecorder({ enabled: true });
    r.startTask("t1");
    r.record("t1", { type: "e", ts: 0, payload: {} });
    r.clear();
    expect(r.getEvents("t1").length).toBe(0);
  });
});
