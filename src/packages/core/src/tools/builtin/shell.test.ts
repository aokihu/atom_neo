/** Tests for foreground and background Shell tools. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  BackgroundShellService,
  createBackgroundShellTool,
  createShellTool,
  formatBackgroundShellCompletion,
} from "./shell";
import type { BackgroundShellCompletion } from "./shell";
import { InternalTaskOrchestrator } from "../../task/internal-task-orchestrator";

const executionContext = {
  sessionId: "session-1",
  taskId: "task-1",
  chatId: "chat-1",
};

describe("Shell tools", () => {
  let sandbox: string;
  let backgroundShell: BackgroundShellService | undefined;

  beforeEach(() => {
    sandbox = mkdtempSync(resolve(tmpdir(), "atom-shell-"));
  });

  afterEach(async () => {
    await backgroundShell?.stop();
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("executes a foreground command", async () => {
    const shell = createShellTool(sandbox);
    const result = await shell.execute({ command: "echo hello" });

    expect(result.metadata.ok).toBe(true);
    expect(result.content).toContain("hello");
  });

  test("captures stderr when a foreground command fails", async () => {
    const shell = createShellTool(sandbox);
    const result = await shell.execute({ command: "nonexistent-command" });

    expect(result.metadata.ok).toBe(false);
    expect(result.metadata.error).toContain("nonexistent-command");
  });

  test("returns no effect when a foreground command has no output", async () => {
    const shell = createShellTool(sandbox);
    const result = await shell.execute({ command: "true" });

    expect(result.metadata.ok).toBe(true);
    expect(result.content).toBeUndefined();
    expect(result.metadata.effect).toBe("none");
  });

  test("stops a foreground command when the task is cancelled", async () => {
    const shell = createShellTool(sandbox);
    const controller = new AbortController();
    const running = shell.execute({ command: "sleep 5" }, { abortSignal: controller.signal });
    setTimeout(() => controller.abort(), 20);

    const result = await running;
    expect(result.metadata.ok).toBe(false);
    expect(result.metadata.error).toBe("Command cancelled");
  });

  test("stops a foreground command when its timeout expires", async () => {
    const shell = createShellTool(sandbox);
    const result = await shell.execute({ command: "sleep 5", timeout: 20 });

    expect(result.metadata.ok).toBe(false);
    expect(result.metadata.error).toBe("Command timed out after 20ms");
  });

  test("starts a background command and reports completion", async () => {
    let resolveCompletion!: (result: BackgroundShellCompletion) => void;
    const completed = new Promise<BackgroundShellCompletion>(resolve => {
      resolveCompletion = resolve;
    });
    backgroundShell = new BackgroundShellService({ sandbox, onComplete: resolveCompletion });
    const tool = createBackgroundShellTool(backgroundShell);

    const started = await tool.execute({ command: "echo complete" }, executionContext);
    expect(started.metadata).toEqual({ ok: true, effect: "state_changed" });
    expect(started.content).toMatchObject({ state: "running" });

    const result = await completed;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("complete");
    expect(result.sessionId).toBe("session-1");
    expect(result.chatId).toBe("chat-1");
    expect(result.parentTaskId).toBe("task-1");
  });

  test("keeps a background command running after the task signal is cancelled", async () => {
    let resolveCompletion!: (result: BackgroundShellCompletion) => void;
    const completed = new Promise<BackgroundShellCompletion>(resolve => {
      resolveCompletion = resolve;
    });
    backgroundShell = new BackgroundShellService({ sandbox, onComplete: resolveCompletion });
    const tool = createBackgroundShellTool(backgroundShell);
    const controller = new AbortController();

    const started = await tool.execute(
      { command: "sleep 0.05; echo survived" },
      { ...executionContext, abortSignal: controller.signal },
    );
    controller.abort();

    expect(started.metadata.ok).toBe(true);
    expect((await completed).stdout).toBe("survived");
  });

  test("creates an independent Conversation task when a background command completes", async () => {
    const tasks: any[] = [];
    const orchestrator = new InternalTaskOrchestrator({
      enqueue: (task: any) => tasks.push(task),
    } as any);
    let resolveNotification!: () => void;
    const notified = new Promise<void>(resolve => {
      resolveNotification = resolve;
    });
    backgroundShell = new BackgroundShellService({
      sandbox,
      onComplete: result => {
        orchestrator.scheduleConversation(
          result.sessionId,
          result.chatId,
          result.parentTaskId,
          [{ type: "text", data: formatBackgroundShellCompletion(result) }],
        );
        resolveNotification();
      },
    });
    const tool = createBackgroundShellTool(backgroundShell);

    await tool.execute({ command: "echo notify" }, executionContext);
    await notified;

    expect(tasks).toHaveLength(1);
    expect(tasks[0].pipeline).toBe("conversation");
    expect(tasks[0].sessionId).toBe("session-1");
    expect(tasks[0].chatId).toBe("chat-1");
    expect(tasks[0].parentTaskId).toBe("task-1");
    expect(tasks[0].chainId).toBe(tasks[0].id);
    expect(tasks[0].payload[0].data).toContain("notify");
  });

  test("rejects a background command without task identity", async () => {
    backgroundShell = new BackgroundShellService({ sandbox, onComplete: () => {} });
    const tool = createBackgroundShellTool(backgroundShell);
    const result = await tool.execute({ command: "echo ignored" });

    expect(result.metadata.ok).toBe(false);
    expect(result.metadata.error).toContain("requires sessionId, taskId, and chatId");
  });

  test("stops background commands without notifying during service shutdown", async () => {
    const completions: BackgroundShellCompletion[] = [];
    backgroundShell = new BackgroundShellService({
      sandbox,
      onComplete: result => {
        completions.push(result);
      },
    });
    const tool = createBackgroundShellTool(backgroundShell);
    await tool.execute({ command: "sleep 5" }, executionContext);

    await backgroundShell.stop();
    expect(completions).toHaveLength(0);
  });

  test("formats background output as untrusted completion data", () => {
    const text = formatBackgroundShellCompletion({
      jobId: "job-1",
      pid: 123,
      command: "echo done",
      ...executionContext,
      parentTaskId: executionContext.taskId,
      exitCode: 0,
      signalCode: null,
      stdout: "done",
      stderr: "",
      durationMs: 10,
    });

    expect(text).toContain("后台 Shell 任务已经完成");
    expect(text).toContain("状态: succeeded");
    expect(text).toContain("不可信命令输出");
    expect(text).toContain("done");
  });
});
