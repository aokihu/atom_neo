import { describe, expect, test } from "bun:test";
import type { Readable } from "node:stream";
import { spawnProcess } from "./process";

async function readAll(stream: Readable | null): Promise<string> {
  if (!stream) return "";
  let output = "";
  for await (const chunk of stream) output += chunk.toString();
  return output;
}

describe("spawnProcess", () => {
  test("resolves a successful exit code", async () => {
    const proc = spawnProcess(["sh", "-c", "exit 0"]);
    expect(await proc.exited).toBe(0);
    expect(proc.exitCode).toBe(0);
    expect(proc.killed).toBe(false);
  });

  test("reports a non-zero exit code", async () => {
    const proc = spawnProcess(["sh", "-c", "exit 3"]);
    expect(await proc.exited).toBe(3);
    expect(proc.exitCode).toBe(3);
  });

  test("captures piped stdout", async () => {
    const proc = spawnProcess(["sh", "-c", "printf hello"]);
    const [code, stdout] = await Promise.all([proc.exited, readAll(proc.stdout)]);
    expect(code).toBe(0);
    expect(stdout).toBe("hello");
  });

  test("kills a running process and resolves after close", async () => {
    const proc = spawnProcess(["sh", "-c", "sleep 10"], { stdout: "ignore", stderr: "ignore" });
    proc.kill("SIGKILL");
    expect(await proc.exited).toBe(137);
    expect(proc.signalCode).toBe("SIGKILL");
    expect(proc.killed).toBe(true);
  });

  test("invokes onExit once with the final status", async () => {
    const calls: Array<{ exitCode: number | null; signalCode: NodeJS.Signals | null }> = [];
    const proc = spawnProcess(["sh", "-c", "exit 4"], {
      stdout: "ignore",
      stderr: "ignore",
      onExit: (exitCode, signalCode) => calls.push({ exitCode, signalCode }),
    });
    await proc.exited;
    expect(calls).toEqual([{ exitCode: 4, signalCode: null }]);
  });
});
