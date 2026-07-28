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
    expect(result.metadata.ok).toBe(true);
    expect(result.content).toContain("hello");
  });
  test("captures stderr on failure", async () => {
    const result = await bash.execute({ command: "nonexistent-command 2>&1" });
    expect(result.metadata.ok).toBe(false);
  });
  test("handles empty output", async () => {
    const result = await bash.execute({ command: "true" });
    expect(result.metadata.ok).toBe(true);
    expect(result.content).toBeUndefined();
    expect(result.metadata.effect).toBe("none");
  });
  test("stops the process when the task signal is cancelled", async () => {
    const controller = new AbortController();
    const running = bash.execute({ command: "sleep 5" }, { abortSignal: controller.signal });
    setTimeout(() => controller.abort(), 20);

    const result = await running;
    expect(result.metadata.ok).toBe(false);
    expect(result.metadata.error).toBe("Command cancelled");
  });
});
