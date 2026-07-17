import { describe, test, expect } from "bun:test";
import { createBashTool } from "./bash";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const sandbox = mkdtempSync(resolve(tmpdir(), "atom-bash-"));
const bash = createBashTool(sandbox);
// sandbox recreated by createBashTool internally

describe("bash tool", () => {
  test("executes a simple command", async () => {
    const result = await bash.execute({ command: "echo hello" });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("hello");
  });
  test("captures stderr on failure", async () => {
    const result = await bash.execute({ command: "nonexistent-command 2>&1" });
    expect(result.ok).toBe(false);
  });
  test("handles empty output", async () => {
    const result = await bash.execute({ command: "true" });
    expect(result.ok).toBe(true);
    expect(result.output).toBe("(no output)");
  });
  test("stops the process when the task signal is cancelled", async () => {
    const controller = new AbortController();
    const running = bash.execute({ command: "sleep 5" }, { abortSignal: controller.signal });
    setTimeout(() => controller.abort(), 20);

    const result = await running;
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Command cancelled");
  });
});
