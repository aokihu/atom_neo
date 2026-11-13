import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  S12_EXCEPTIONS,
  S12_TARGETS,
  checkCodeSize,
  countFileLines,
} from "./check-code-size";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "atom-size-"));
}

describe("countFileLines", () => {
  test("matches wc -l semantics", () => {
    expect(countFileLines("")).toBe(0);
    expect(countFileLines("one")).toBe(1);
    expect(countFileLines("one\n")).toBe(1);
    expect(countFileLines("one\ntwo\n")).toBe(2);
  });
});

describe("checkCodeSize", () => {
  test("fails a file over budget", async () => {
    const root = tempRoot();
    writeFileSync(join(root, "large.ts"), `${Array.from({ length: 12 }, (_, index) => `const v${index} = ${index};`).join("\n")}\n`);
    writeFileSync(join(root, "small.ts"), "export const value = 1;\n");

    const report = await checkCodeSize([
      { file: "large.ts", maxLines: 10 },
      { file: "small.ts", maxLines: 10 },
    ], root);

    expect(report.ok).toBe(false);
    expect(report.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: "large.ts", lines: 12, maxLines: 10 }),
    ]));
    expect(report.issues).toEqual([expect.objectContaining({ file: "large.ts", kind: "file", actual: 12, max: 10 })]);
  }, 30_000);

  test("fails a function over 100 body lines and reports its start line", async () => {
    const root = tempRoot();
    const source = [
      "export function small() {",
      "  return 1;",
      "}",
      "",
      "function large() {",
      ...Array.from({ length: 101 }, (_, index) => `  value += ${index};`),
      "}",
      "",
    ].join("\n");
    writeFileSync(join(root, "function.ts"), source);

    const report = await checkCodeSize([{ file: "function.ts", maxLines: 200 }], root);

    expect(report.ok).toBe(false);
    expect(report.issues).toEqual([
      expect.objectContaining({ file: "function.ts", kind: "function", name: "large", line: 5, max: 100 }),
    ]);
    expect(report.functions).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "small", line: 1, lines: 3 }),
      expect.objectContaining({ name: "large", line: 5 }),
    ]));
  }, 30_000);

  test("ignores overload signatures without bodies", async () => {
    const root = tempRoot();
    writeFileSync(
      join(root, "overload.ts"),
      "export function overloaded(value: string): string;\nexport function overloaded(value: string) { return value; }\n",
    );

    const report = await checkCodeSize([{ file: "overload.ts", maxLines: 10 }], root);
    expect(report.functions.filter((entry) => entry.name === "overloaded")).toHaveLength(1);
  }, 30_000);

  test("fails when a target file is missing", async () => {
    const report = await checkCodeSize([{ file: "missing.ts", maxLines: 10 }], tempRoot());
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual([expect.objectContaining({ file: "missing.ts", kind: "missing" })]);
  }, 30_000);

  test("passes the S12 target set", async () => {
    const report = await checkCodeSize();
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
  }, 60_000);
});

describe("documented exceptions", () => {
  test("no frozen exceptions remain", () => {
    expect(S12_EXCEPTIONS).toEqual([]);
  });

  test("protocol and session context are normal 300-line targets", () => {
    expect(S12_TARGETS).toEqual(expect.arrayContaining([
      { file: "src/packages/shared/src/protocol.ts", maxLines: 300 },
      { file: "src/packages/core/src/session/context.ts", maxLines: 300 },
    ]));
  });

  test("no S12 target is marked as an exception", () => {
    expect(S12_TARGETS.every((target) => target.exception !== true)).toBe(true);
  });
});
