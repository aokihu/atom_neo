import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { BusEvents } from "@atom-neo/shared";
import { ToolCallLedger } from "../../../../tools/governance";
import { ToolStatusCollector } from "./tool-result-status";
import { createToolRuntime } from "./tool-runtime";
import { wrapMCPAiTools } from "./tool-runtime-mcp";

function makeProbe(execute: (args: any) => Promise<any>, name = "probe") {
  return {
    name,
    source: "builtin" as const,
    description: "Probe",
    inputSchema: z.object({ value: z.string().optional(), todos: z.array(z.any()).optional() }),
    execute,
  };
}

describe("builtin tool runtime", () => {
  test("records success, transport status, and governance result", async () => {
    const events: any[] = [];
    const runtime = createToolRuntime({
      tools: [makeProbe(async args => ({
        content: `probe:${args.value}`,
        metadata: { ok: true, effect: "state_changed" },
      }))],
      report: (event, payload) => events.push({ event, payload }),
      maxSteps: 10,
    });

    expect(await runtime.builtinTools.probe.execute({ value: "x" })).toBe("probe:x");
    expect(events.map(item => item.payload.step)).toEqual([
      "tool-governance-decision",
      "tool-execute-start",
      "tool-execute-done",
      "tool-governance-result",
    ]);
    expect(runtime.statuses.take("probe")).toMatchObject({
      content: "probe:x",
      rawOutput: "probe:x",
      metadata: { ok: true, effect: "state_changed" },
      startedAt: expect.any(Number),
      durationMs: expect.any(Number),
    });
  });

  test("records thrown errors and blocks duplicate calls", async () => {
    const events: any[] = [];
    let calls = 0;
    const runtime = createToolRuntime({
      tools: [makeProbe(async () => {
        calls++;
        if (calls === 1) throw new Error("boom");
        return { content: "ok", metadata: { ok: true, effect: "none" } };
      })],
      report: (event, payload) => events.push({ event, payload }),
      maxSteps: 10,
    });

    expect(await runtime.builtinTools.probe.execute({ value: "x" }))
      .toBe("Tool execution error: boom");
    expect(runtime.statuses.take("probe")?.metadata).toEqual({
      ok: false,
      effect: "none",
      error: "boom",
      errorSource: "tool",
    });
    expect(await runtime.builtinTools.probe.execute({ value: "x" }))
      .toContain("Do not repeat this tool call");
    expect(events.filter(item => item.payload.step === "tool-governance-decision").at(-1)?.payload)
      .toMatchObject({ decision: "block", reason: "duplicate_request" });
  });

  test("fails closed when a Tool returns no metadata", async () => {
    const runtime = createToolRuntime({
      tools: [makeProbe(async () => ({ content: "x" }) as any)],
      report: () => {},
      maxSteps: 10,
    });
    expect(await runtime.builtinTools.probe.execute({ value: "x" }))
      .toStartWith("Tool execution error:");
  });

  test("writes todowrite state only on success", async () => {
    let todos: any[] = [];
    const runtime = createToolRuntime({
      tools: [makeProbe(async () => ({
        content: "updated",
        metadata: { ok: true, effect: "state_changed" },
      }), "todowrite")],
      report: () => {},
      maxSteps: 10,
      session: {
        sessionId: "s",
        messages: [],
        todoState: [],
        setTodoState: (items: any[]) => { todos = items; },
      } as any,
    });

    await runtime.builtinTools.todowrite.execute({ todos: [{ content: "one" }] });
    expect(todos).toEqual([{ content: "one" }]);
  });
});

describe("builtin/MCP governance parity", () => {
  test("same invocation produces the same decision fingerprint", async () => {
    const builtinEvents: any[] = [];
    const mcpEvents: any[] = [];
    const runtime = createToolRuntime({
      tools: [makeProbe(async () => ({ content: "same", metadata: { ok: true, effect: "reference" } }))],
      report: (_event, payload) => builtinEvents.push(payload),
      maxSteps: 10,
    });
    const wrapped = wrapMCPAiTools({
      probe: { execute: async () => ({ content: "same" }) },
    }, (_event, payload) => mcpEvents.push(payload), { count: 0 }, new ToolStatusCollector(), {
      current: new ToolCallLedger({ maxExecutions: 10 }),
    });

    await runtime.builtinTools.probe.execute({ value: "same" });
    await wrapped.probe.execute({ value: "same" });

    const builtin = builtinEvents.find(event => event.step === "tool-governance-decision");
    const mcp = mcpEvents.find(event => event.step === "tool-governance-decision");
    expect(builtin).toMatchObject({ decision: "execute", stepCount: 1 });
    expect(mcp).toMatchObject({ decision: "execute", stepCount: 1, source: "mcp" });
    expect(builtin.fingerprint).toBe(mcp.fingerprint);
    expect(builtinEvents.find(event => event.step === "tool-governance-result"))
      .toMatchObject({ ok: true, effect: "reference" });
    expect(mcpEvents.find(event => event.step === "tool-governance-result"))
      .toMatchObject({ ok: true, effect: "reference", source: "mcp" });
  });
});

test("tool runtime events keep the shared element channel", async () => {
  const events: string[] = [];
  const runtime = createToolRuntime({
    tools: [makeProbe(async () => ({ content: "x", metadata: { ok: true, effect: "none" } }))],
    report: (event, payload) => events.push(`${event}:${payload.step}`),
    maxSteps: 10,
  });
  await runtime.builtinTools.probe.execute({});
  expect(events).toContain(`${BusEvents.Element.Data}:tool-execute-start`);
});
