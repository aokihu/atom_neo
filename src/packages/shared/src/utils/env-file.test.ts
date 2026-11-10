import { describe, expect, test } from "bun:test";
import { mergeEnv, parseEnv, parseEnvEntries, parseEnvKeys, serializeEnv, upsertEnv } from "./env-file";

describe("parseEnv", () => {
  test("parses plain, exported, quoted, commented, and CRLF files", () => {
    const content = [
      "# leading comment",
      "",
      "PLAIN=value",
      "export EXPORTED=value2",
      'DOUBLE="hello world"',
      "SINGLE='literal # value'",
      "ESCAPED=\"line\\nnext\\tend\"",
      "EMPTY=",
      "CRLF=yes",
    ].join("\r\n");

    expect(parseEnv(content)).toEqual({
      PLAIN: "value",
      EXPORTED: "value2",
      DOUBLE: "hello world",
      SINGLE: "literal # value",
      ESCAPED: "line\nnext\tend",
      EMPTY: "",
      CRLF: "yes",
    });
  });

  test("keeps the last value for duplicate keys", () => {
    expect(parseEnv("A=1\nexport A=2\nB=3\n")).toEqual({ A: "2", B: "3" });
  });

  test("exposes ordered entries and unique keys", () => {
    expect(parseEnvEntries("# c\nexport B=2\nA=1\nB=3\n")).toEqual([
      { key: "B", value: "2" },
      { key: "A", value: "1" },
      { key: "B", value: "3" },
    ]);
    expect(parseEnvKeys("# c\nexport B=2\nA=1\nB=3\n")).toEqual(["B", "A"]);
  });

  test("ignores malformed lines", () => {
    expect(parseEnv("NO_EQUALS\n1BAD=x\n  spaced line\nOK=1\n")).toEqual({ OK: "1" });
  });
});

describe("serializeEnv", () => {
  test("round-trips values that need quoting", () => {
    const entries = {
      PLAIN: "sk-abc",
      SPACE: "hello world",
      HASH: "value # not a comment",
      QUOTE: 'say "hi"',
      NEWLINE: "a\nb",
      EMPTY: "",
    };
    expect(parseEnv(serializeEnv(entries))).toEqual(entries);
  });

  test("honours the requested EOL", () => {
    expect(serializeEnv({ A: "1", B: "2" }, "\r\n")).toBe("A=1\r\nB=2\r\n");
  });
});

describe("upsertEnv", () => {
  test("updates in place, preserves comments/order, and appends new keys", () => {
    const content = "# keep\nA=old\n\nB=keep\n";
    expect(upsertEnv(content, { A: "new", C: "added" }))
      .toBe("# keep\nA=new\n\nB=keep\nC=added\n");
  });

  test("matches export lines and preserves the export prefix", () => {
    expect(upsertEnv("export A=old\nB=1\n", { A: "new" })).toBe("export A=new\nB=1\n");
  });

  test("updates every duplicate of the same key", () => {
    expect(upsertEnv("A=1\nB=2\nA=3\n", { A: "x" })).toBe("A=x\nB=2\nA=x\n");
  });

  test("preserves CRLF files", () => {
    expect(upsertEnv("A=1\r\n# c\r\n", { B: "2" })).toBe("A=1\r\n# c\r\nB=2\r\n");
  });

  test("creates content for a missing file and quotes special values", () => {
    const output = upsertEnv("", { A: "hello world" });
    expect(output).toBe('A="hello world"\n');
    expect(parseEnv(output)).toEqual({ A: "hello world" });
  });
});

describe("mergeEnv", () => {
  test("incoming values win while local comments and order stay", () => {
    const local = "# local\nLOCAL=keep\nDEEPSEEK_API_KEY=old\n# tail\n";
    const incoming = "DEEPSEEK_API_KEY=new\nexport OPENAI_API_KEY=sk-new\n";
    expect(mergeEnv(local, incoming))
      .toBe("# local\nLOCAL=keep\nDEEPSEEK_API_KEY=new\n# tail\nexport OPENAI_API_KEY=sk-new\n");
  });

  test("deduplicates local keys covered by the archive", () => {
    expect(mergeEnv("A=1\nA=2\n", "A=new\n")).toBe("A=new\n");
  });

  test("supports CRLF and empty locals", () => {
    expect(mergeEnv("A=1\r\n# c\r\n", "B=2\r\n")).toBe("A=1\r\n# c\r\nB=2\r\n");
    expect(mergeEnv("", "A=1\r\nB=2\r\n")).toBe("A=1\r\nB=2\r\n");
  });

  test("returns empty when both sides are empty", () => {
    expect(mergeEnv("", "")).toBe("");
  });
});
