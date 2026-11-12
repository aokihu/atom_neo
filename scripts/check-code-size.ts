/**
 * S12 code-size guard.
 *
 * Checks the S12 target files from docs/code-review-2026-11-10/code-review-s12-2026-11-12.md
 * section 5 for file line budgets and function body budgets. Only the two documented
 * exceptions (protocol.ts and core session/context.ts) are allowed to exceed the
 * normal 300-line limit.
 *
 * The compiler AST comes from the TypeScript 7 async API because the TypeScript 7
 * package no longer exposes the legacy in-process compiler API.
 *
 * Usage:
 *   bun run scripts/check-code-size.ts [--json]
 *
 * Exit code 1 when a target exceeds its budget or a listed file is missing.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { API } from "typescript/unstable/async";
import {
  isArrowFunction,
  isConstructorDeclaration,
  isFunctionDeclaration,
  isFunctionExpression,
  isGetAccessorDeclaration,
  isMethodDeclaration,
  isPropertyAssignment,
  isPropertyDeclaration,
  isSetAccessorDeclaration,
  isVariableDeclaration,
} from "typescript/unstable/ast";
import type { Node, SourceFile } from "typescript/unstable/ast";

export type SizeTarget = {
  file: string;
  maxLines: number;
  /** Documented exception; still checked against its frozen line count. */
  exception?: boolean;
};

export type FunctionMeasurement = {
  file: string;
  name: string;
  line: number;
  lines: number;
  maxLines: number;
};

export type FileMeasurement = {
  file: string;
  lines: number;
  maxLines: number;
  exception: boolean;
};

export type SizeIssue = {
  file: string;
  kind: "missing" | "file" | "function";
  line: number;
  name?: string;
  actual: number;
  max: number;
};

export type SizeReport = {
  ok: boolean;
  files: FileMeasurement[];
  functions: FunctionMeasurement[];
  issues: SizeIssue[];
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const FUNCTION_LINE_LIMIT = 100;

/** S12 section 5 file budgets, in the same order as the document. */
export const S12_TARGETS: readonly SizeTarget[] = [
  { file: "src/packages/core/src/pipelines/conversation/elements/stream-llm.ts", maxLines: 220 },
  { file: "src/packages/core/src/pipelines/conversation/elements/stream/stream-loop.ts", maxLines: 280 },
  { file: "src/packages/core/src/pipelines/conversation/elements/stream/stream-step.ts", maxLines: 240 },
  { file: "src/packages/core/src/pipelines/conversation/elements/stream/stream-context.ts", maxLines: 180 },
  { file: "src/packages/core/src/pipelines/conversation/elements/stream/stream-reporting.ts", maxLines: 140 },
  { file: "src/packages/core/src/pipelines/conversation/elements/stream/stream-finalize.ts", maxLines: 130 },
  { file: "src/packages/core/src/pipelines/conversation/elements/stream/stream-model-input.ts", maxLines: 120 },
  { file: "src/packages/core/src/pipelines/conversation/elements/stream/tool-batch.ts", maxLines: 200 },
  { file: "src/packages/core/src/pipelines/conversation/elements/stream/tool-runtime.ts", maxLines: 220 },
  { file: "src/packages/core/src/pipelines/conversation/elements/stream/tool-runtime-mcp.ts", maxLines: 140 },
  { file: "src/packages/core/src/pipelines/conversation/elements/stream/tool-governance-runtime.ts", maxLines: 120 },
  { file: "src/packages/core/src/pipelines/conversation/elements/stream/tool-result-status.ts", maxLines: 100 },
  { file: "src/services/memory-service.ts", maxLines: 180 },
  { file: "src/services/memory/memory-store.ts", maxLines: 260 },
  { file: "src/services/memory/memory-query.ts", maxLines: 170 },
  { file: "src/services/memory/memory-graph.ts", maxLines: 130 },
  { file: "src/services/memory/memory-types.ts", maxLines: 70 },
  { file: "src/packages/core/src/context/context-service.ts", maxLines: 200 },
  { file: "src/packages/core/src/context/bucket-store.ts", maxLines: 200 },
  { file: "src/packages/core/src/context/snapshot-manager.ts", maxLines: 220 },
  { file: "src/packages/core/src/context/context-codec.ts", maxLines: 100 },
  { file: "src/packages/core/src/context/context-types.ts", maxLines: 100 },
  { file: "src/packages/core/src/session/persistence-service.ts", maxLines: 180 },
  { file: "src/packages/core/src/session/checkpoint-store.ts", maxLines: 230 },
  { file: "src/packages/core/src/session/history-store.ts", maxLines: 190 },
  { file: "src/packages/core/src/session/session-format.ts", maxLines: 150 },
  { file: "src/packages/core/src/session/durable-fs.ts", maxLines: 80 },
  { file: "src/packages/gateway/src/client-manager/process-supervisor.ts", maxLines: 280 },
  { file: "src/packages/gateway/src/client-manager/client-command.ts", maxLines: 100 },
  { file: "src/packages/gateway/src/client-manager/process-termination.ts", maxLines: 90 },
  { file: "src/packages/core/src/pipelines/conversation/elements/check-follow-up.ts", maxLines: 150 },
  { file: "src/packages/core/src/pipelines/conversation/elements/continuation-rules.ts", maxLines: 130 },
  { file: "src/packages/core/src/pipelines/conversation/elements/continuation-arbitration.ts", maxLines: 120 },
  { file: "src/packages/core/src/pipelines/context-compress/elements/compress-finalize.ts", maxLines: 150 },
  { file: "src/packages/core/src/pipelines/context-compress/elements/compress-commit.ts", maxLines: 130 },
  { file: "src/packages/core/src/pipelines/context-compress/elements/compress-resume.ts", maxLines: 80 },
  { file: "src/packages/core/src/session/message-projection.ts", maxLines: 120 },
  { file: "src/packages/tui/src/stores/chat.ts", maxLines: 120 },
  { file: "src/packages/tui/src/stores/chat/message-slice.ts", maxLines: 100 },
  { file: "src/packages/tui/src/stores/chat/stream-slice.ts", maxLines: 100 },
  { file: "src/packages/tui/src/stores/chat/tool-slice.ts", maxLines: 100 },
  { file: "src/packages/tui/src/stores/chat/telemetry-slice.ts", maxLines: 100 },
  { file: "src/packages/tui/src/hooks/useChat.ts", maxLines: 120 },
  { file: "src/packages/tui/src/hooks/chat-connection.ts", maxLines: 150 },
  { file: "src/packages/tui/src/components/ChatView.tsx", maxLines: 90 },
  { file: "src/packages/tui/src/components/chat-view-model.ts", maxLines: 70 },
  { file: "src/packages/tui/src/components/Sidebar.tsx", maxLines: 120 },
  { file: "src/packages/tui/src/components/sidebar/ContextSection.tsx", maxLines: 110 },
  { file: "src/packages/tui/src/components/sidebar/McpSection.tsx", maxLines: 110 },
  { file: "src/packages/tui/src/components/sidebar/NetworkSection.tsx", maxLines: 110 },
  { file: "src/packages/tui/src/components/sidebar/RoundsSection.tsx", maxLines: 110 },
  { file: "src/packages/tui/src/components/sidebar/TelemetrySection.tsx", maxLines: 110 },
  { file: "src/packages/tui/src/components/sidebar/TodoSection.tsx", maxLines: 110 },
  { file: "src/packages/tui/src/components/sidebar/ToolsSection.tsx", maxLines: 110 },
  { file: "src/packages/tui/src/components/RuntimeSidebar.tsx", maxLines: 120 },
  { file: "src/packages/tui/src/components/runtime/runtime-steps.ts", maxLines: 100 },
  { file: "src/packages/tui/src/components/runtime/RuntimeDecisionSection.tsx", maxLines: 100 },
  { file: "src/packages/tui/src/components/runtime/RuntimePipelineSection.tsx", maxLines: 100 },
  { file: "src/packages/tui/src/components/runtime/RuntimeSection.tsx", maxLines: 100 },
  { file: "src/packages/tui/src/components/runtime/RuntimeSessionSection.tsx", maxLines: 100 },
  { file: "src/packages/tui/src/components/runtime/RuntimeStatsSection.tsx", maxLines: 100 },
  { file: "src/packages/tui/src/components/runtime/RuntimeStreamSection.tsx", maxLines: 100 },
  { file: "src/packages/tui/src/components/SettingsModal.tsx", maxLines: 130 },
  { file: "src/packages/tui/src/components/settings/settings-model.ts", maxLines: 100 },
  { file: "src/packages/tui/src/components/settings/use-settings-config.ts", maxLines: 120 },
  { file: "src/packages/tui/src/components/InputBar.tsx", maxLines: 170 },
  { file: "src/packages/tui/src/components/input/use-command-menu.ts", maxLines: 100 },
  { file: "src/packages/tui/src/components/input/use-double-escape.ts", maxLines: 100 },
  { file: "src/packages/tui/src/components/App.tsx", maxLines: 160 },
  { file: "src/packages/tui/src/components/app/AppModal.tsx", maxLines: 180 },
  { file: "src/packages/config-tui/src/components/WizardApp.tsx", maxLines: 180 },
  { file: "src/packages/config-tui/src/wizard/wizard-reducer.ts", maxLines: 220 },
  { file: "src/packages/config-tui/src/wizard/wizard-state.ts", maxLines: 150 },
  { file: "src/packages/config-tui/src/wizard/wizard-edit.ts", maxLines: 130 },
  { file: "src/packages/config-tui/src/wizard/wizard-commit.ts", maxLines: 120 },
  { file: "src/packages/config-tui/src/wizard-logic.ts", maxLines: 50 },
];

/** Documented >300-line exceptions from S12 section 5. Frozen, not targets. */
export const S12_EXCEPTIONS: readonly SizeTarget[] = [
  { file: "src/packages/shared/src/protocol.ts", maxLines: 313, exception: true },
  { file: "src/packages/core/src/session/context.ts", maxLines: 309, exception: true },
];

export function countFileLines(source: string): number {
  if (source.length === 0) return 0;
  const lines = source.split("\n").length;
  return source.endsWith("\n") ? lines - 1 : lines;
}

function functionName(node: Node, sourceFile: SourceFile): string {
  const named = node as Node & { name?: Node };
  if (named.name) return named.name.getText(sourceFile);
  if (isConstructorDeclaration(node)) return "constructor";

  const parent = node.parent;
  if (parent && (isVariableDeclaration(parent) || isPropertyDeclaration(parent))) {
    return parent.name.getText(sourceFile);
  }
  if (parent && isPropertyAssignment(parent)) return parent.name.getText(sourceFile);
  return "<anonymous>";
}

function isFunctionLike(node: Node): boolean {
  return isFunctionDeclaration(node)
    || isMethodDeclaration(node)
    || isConstructorDeclaration(node)
    || isGetAccessorDeclaration(node)
    || isSetAccessorDeclaration(node)
    || isFunctionExpression(node)
    || isArrowFunction(node);
}

export function measureFunctions(
  file: string,
  sourceFile: SourceFile,
  maxLines = FUNCTION_LINE_LIMIT,
): FunctionMeasurement[] {
  const measurements: FunctionMeasurement[] = [];

  const visit = (node: Node): void => {
    if (isFunctionLike(node)) {
      const body = (node as Node & { body?: Node }).body;
      if (body) {
        const start = sourceFile.getLineAndCharacterOfPosition(body.getStart(sourceFile)).line + 1;
        const end = sourceFile.getLineAndCharacterOfPosition(body.end).line + 1;
        measurements.push({
          file,
          name: functionName(node, sourceFile),
          line: start,
          lines: end - start + 1,
          maxLines,
        });
      }
    }
    node.forEachChild(visit);
  };

  visit(sourceFile);
  return measurements;
}

export async function checkCodeSize(
  targets: readonly SizeTarget[] = [...S12_TARGETS, ...S12_EXCEPTIONS],
  root = ROOT,
): Promise<SizeReport> {
  const files: FileMeasurement[] = [];
  const functions: FunctionMeasurement[] = [];
  const issues: SizeIssue[] = [];
  const existing: Array<{ target: SizeTarget; absolute: string }> = [];

  for (const target of targets) {
    const absolute = resolve(root, target.file);
    if (!existsSync(absolute)) {
      issues.push({ file: target.file, kind: "missing", line: 0, actual: 0, max: target.maxLines });
      continue;
    }
    existing.push({ target, absolute });
  }

  if (existing.length > 0) {
    const api = new API();
    try {
      const snapshot = await api.updateSnapshot({ openFiles: existing.map((entry) => entry.absolute) });
      for (const { target, absolute } of existing) {
        const source = readFileSync(absolute, "utf8");
        const lines = countFileLines(source);
        const project = await snapshot.getDefaultProjectForFile(absolute);
        const sourceFile = await project?.program.getSourceFile(absolute);
        files.push({
          file: target.file,
          lines,
          maxLines: target.maxLines,
          exception: target.exception === true,
        });
        if (lines > target.maxLines) {
          issues.push({ file: target.file, kind: "file", line: 0, actual: lines, max: target.maxLines });
        }
        if (!sourceFile) {
          issues.push({ file: target.file, kind: "missing", line: 0, actual: 0, max: target.maxLines });
          continue;
        }
        for (const measurement of measureFunctions(target.file, sourceFile)) {
          functions.push(measurement);
          if (measurement.lines > FUNCTION_LINE_LIMIT) {
            issues.push({
              file: target.file,
              kind: "function",
              line: measurement.line,
              name: measurement.name,
              actual: measurement.lines,
              max: FUNCTION_LINE_LIMIT,
            });
          }
        }
      }
    } finally {
      await api.close();
    }
  }

  return { ok: issues.length === 0, files, functions, issues };
}

export function formatReport(report: SizeReport): string {
  const lines: string[] = [];
  const exceptions = report.files.filter((file) => file.exception);
  const targets = report.files.filter((file) => !file.exception);

  for (const file of targets) {
    const status = file.lines <= file.maxLines ? "PASS" : "FAIL";
    lines.push(`${status} ${file.file} ${file.lines}/${file.maxLines}`);
  }
  for (const file of exceptions) {
    const status = file.lines <= file.maxLines ? "EXCEPTION" : "FAIL";
    lines.push(`${status} ${file.file} ${file.lines}/${file.maxLines}`);
  }

  for (const issue of report.issues) {
    if (issue.kind === "missing") {
      lines.push(`FAIL ${issue.file} missing file`);
    } else if (issue.kind === "file") {
      lines.push(`FAIL ${issue.file} ${issue.actual} lines > ${issue.max}`);
    } else {
      lines.push(`FAIL ${issue.file}:${issue.line} function ${issue.name} body ${issue.actual} lines > ${issue.max}`);
    }
  }

  const longest = report.functions.reduce(
    (max, fn) => (fn.lines > max.lines ? fn : max),
    { file: "", name: "", line: 0, lines: 0, maxLines: FUNCTION_LINE_LIMIT },
  );
  lines.push(`SUMMARY ${targets.length} targets, ${exceptions.length} exceptions, longest function ${longest.lines} lines (${longest.name} @ ${longest.file}:${longest.line})`);
  lines.push(report.ok ? "OK" : "FAILED");
  return lines.join("\n");
}

if (import.meta.main) {
  const report = await checkCodeSize();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReport(report));
  }
  if (!report.ok) process.exitCode = 1;
}
