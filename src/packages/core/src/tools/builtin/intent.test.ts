import { describe, expect, test } from "bun:test";
import { IntentInputSchema } from "./intent";

describe("IntentInputSchema", () => {
  test("accepts retain_memory intent", () => {
    const result = IntentInputSchema.safeParse({
      action: "retain_memory",
      mem_id: "memory-id",
    });

    expect(result.success).toBe(true);
  });

  test("rejects legacy keep_memory intent", () => {
    const result = IntentInputSchema.safeParse({
      action: "keep_memory",
      mem_id: "memory-id",
    });

    expect(result.success).toBe(false);
  });
});
