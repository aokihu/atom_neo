import { describe, test, expect } from "bun:test";
import { bashTool } from "./bash";

describe("bash tool", () => {
  test("executes a simple command", async () => {
    const result = await bashTool.execute({ command: "echo hello" });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("hello");
  });

  test("captures stderr on failure", async () => {
    const result = await bashTool.execute({ command: "nonexistent-command 2>&1" });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test("respects timeout", async () => {
    const result = await bashTool.execute({ command: "sleep 2", timeout: 50 });
    expect(result.ok).toBe(false);
  });

  test("handles empty output", async () => {
    const result = await bashTool.execute({ command: "true" });
    expect(result.ok).toBe(true);
    expect(result.output).toBe("(no output)");
  });
});
