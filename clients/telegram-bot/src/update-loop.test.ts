import { describe, expect, test } from "bun:test";
import { GatewayBusyError } from "./gateway-client";
import { processUpdateBatch, type UpdateLoopState } from "./update-loop";

function state(offset = 0, retries: [string, number][] = []): UpdateLoopState {
  return { offset, retries: new Map(retries) };
}

describe("processUpdateBatch", () => {
  test("advances the offset and clears retries on success", async () => {
    const updates = [{ update_id: 10 }, { update_id: 11 }];
    const seen: number[] = [];
    const loop = state(10, [["u10", 2]]);

    const result = await processUpdateBatch(updates, loop, async (update) => {
      seen.push(update.update_id);
    });

    expect(result).toEqual({});
    expect(seen).toEqual([10, 11]);
    expect(loop.offset).toBe(12);
    expect(loop.retries.size).toBe(0);
  });

  test("stops on a busy gateway without advancing the offset or retry count", async () => {
    const loop = state(10, [["u10", 1]]);
    const seen: number[] = [];

    const result = await processUpdateBatch([{ update_id: 10 }, { update_id: 11 }], loop, async (update) => {
      seen.push(update.update_id);
      throw new GatewayBusyError(503, 1_500);
    });

    expect(result).toEqual({ retryAfterMs: 1_500 });
    expect(seen).toEqual([10]);
    expect(loop.offset).toBe(10);
    expect(loop.retries.get("u10")).toBe(1);
  });

  test("keeps earlier successes when a later update is busy", async () => {
    const loop = state();

    const result = await processUpdateBatch([{ update_id: 1 }, { update_id: 2 }], loop, async (update) => {
      if (update.update_id === 2) throw new GatewayBusyError(429, 2_000);
    });

    expect(result).toEqual({ retryAfterMs: 2_000 });
    expect(loop.offset).toBe(2);
    expect(loop.retries.size).toBe(0);
  });

  test("retries other failures, then skips after maxAttempts and continues", async () => {
    const loop = state(5);
    const seen: number[] = [];
    const failure = new Error("gateway rejected message (400)");
    const handle = async (update: { update_id: number }) => {
      seen.push(update.update_id);
      if (update.update_id === 5) throw failure;
    };

    const first = await processUpdateBatch([{ update_id: 5 }, { update_id: 6 }], loop, handle, 2);
    expect(first).toEqual({});
    expect(seen).toEqual([5]);
    expect(loop.offset).toBe(5);
    expect(loop.retries.get("u5")).toBe(1);

    const second = await processUpdateBatch([{ update_id: 5 }, { update_id: 6 }], loop, handle, 2);
    expect(second).toEqual({});
    expect(seen).toEqual([5, 5, 6]);
    expect(loop.offset).toBe(7);
    expect(loop.retries.size).toBe(0);
  });

  test("does not mutate input updates", async () => {
    const first = Object.freeze({ update_id: 1, text: "one" });
    const updates = Object.freeze([first, Object.freeze({ update_id: 2, text: "two" })]);
    const loop = state();

    await processUpdateBatch(updates, loop, async () => {});

    expect(updates).toEqual([
      { update_id: 1, text: "one" },
      { update_id: 2, text: "two" },
    ]);
    expect(loop.offset).toBe(3);
  });
});
