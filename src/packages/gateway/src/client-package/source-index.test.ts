import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { SourceIndexEntry } from "./source-index";
import {
  compareSourceVersions,
  createSourceIndexEntry,
  loadSourceIndex,
  mergeSourceIndexEntries,
  parseSourceIndex,
  selectSourceEntry,
  sourceIndexDocument,
} from "./source-index";

const HOST = `${process.platform}-${process.arch}`;
const OTHER_TARGET = HOST === "linux-x64" ? "darwin-arm64" : "linux-x64";
const SHA = "a".repeat(64);
const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "atom-source-index-test-"));
  tempDirs.push(dir);
  return dir;
}

function entry(overrides: Partial<SourceIndexEntry> = {}): SourceIndexEntry {
  return {
    id: "demo-bot",
    version: "1.0.0",
    target: HOST,
    url: "https://example.invalid/demo-bot-1.0.0.tar.gz",
    sha256: SHA,
    size: 1,
    ...overrides,
  };
}

function rawEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...entry(), ...overrides };
}

function indexText(entries: readonly unknown[]): string {
  return JSON.stringify({ version: 1, entries });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("parseSourceIndex", () => {
  test("parses valid entries, normalizes sha256, and compares versions numerically", () => {
    const index = parseSourceIndex(
      indexText([rawEntry({ sha256: "A".repeat(64), version: "1.10.0" })]),
      "fixture.json",
    );

    expect(index.version).toBe(1);
    expect(index.entries[0]).toEqual(entry({ sha256: SHA, version: "1.10.0" }));
    expect(compareSourceVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareSourceVersions("2.0.0", "2.0.0")).toBe(0);
    expect(compareSourceVersions("1.0.0", "2.0.0")).toBe(-1);
  });

  test("reports missing and invalid sha256 with the index location", () => {
    const { sha256: _sha256, ...missing } = rawEntry();

    expect(() => parseSourceIndex(indexText([missing]), "fixture.json")).toThrow(/fixture\.json.*sha256/);
    expect(() => parseSourceIndex(indexText([rawEntry({ sha256: "abc" })]), "fixture.json")).toThrow(
      /fixture\.json.*sha256/,
    );
  });

  test("rejects duplicate id/version/target entries", () => {
    expect(() => parseSourceIndex(indexText([rawEntry(), rawEntry()]), "duplicates.json")).toThrow(
      /duplicates\.json.*duplicate entry/,
    );
    expect(() => sourceIndexDocument([entry(), entry()])).toThrow(/duplicate entry/);
  });

  test("rejects non-http URLs, public plain HTTP, non-positive sizes, and unknown fields", () => {
    for (const invalid of [
      rawEntry({ url: "ftp://example.invalid/demo-bot.tar.gz" }),
      rawEntry({ url: "http://example.invalid/demo-bot.tar.gz" }),
      rawEntry({ size: 0 }),
      rawEntry({ checksum: SHA }),
    ]) {
      expect(() => parseSourceIndex(indexText([invalid]), "invalid.json")).toThrow(/invalid\.json/);
    }
    expect(parseSourceIndex(indexText([rawEntry({ url: "https://example.invalid/demo-bot.tar.gz" })])))
      .toBeDefined();
    expect(parseSourceIndex(indexText([rawEntry({ url: "http://127.0.0.1/demo-bot.tar.gz" })])))
      .toBeDefined();
  });
});

describe("mergeSourceIndexEntries", () => {
  test("accumulates targets, is idempotent, and rejects conflicting content", () => {
    const host = entry();
    const other = entry({ target: OTHER_TARGET, url: "https://example.invalid/other.tar.gz" });
    const merged = mergeSourceIndexEntries(sourceIndexDocument([host]), [other]);
    expect(merged.entries.map(item => item.target).sort()).toEqual([HOST, OTHER_TARGET].sort());

    expect(mergeSourceIndexEntries(merged, [host]).entries).toHaveLength(2);
    expect(() => mergeSourceIndexEntries(merged, [{
      ...host,
      sha256: "c".repeat(64),
    }])).toThrow("Conflicting source index entry");
  });
});

describe("selectSourceEntry", () => {
  test("selects the highest host version and supports exact target/version selection", () => {
    const index = parseSourceIndex(
      indexText([
        rawEntry({ version: "1.9.0" }),
        rawEntry({ version: "1.10.0" }),
        rawEntry({ version: "9.0.0", target: OTHER_TARGET }),
      ]),
      "fixture.json",
    );

    expect(selectSourceEntry(index, { id: "demo-bot" }).version).toBe("1.10.0");
    expect(selectSourceEntry(index, { id: "demo-bot", version: "1.9.0" }).version).toBe("1.9.0");
    expect(selectSourceEntry(index, { id: "demo-bot", target: OTHER_TARGET }).version).toBe("9.0.0");
  });

  test("rejects unknown ids, missing versions, and unsupported targets", () => {
    const index = parseSourceIndex(indexText([rawEntry()]), "fixture.json");

    expect(() => selectSourceEntry(index, { id: "missing" })).toThrow(/Unknown source package "missing"/);
    expect(() => selectSourceEntry(index, { id: "demo-bot", version: "2.0.0" })).toThrow(
      /demo-bot@2\.0\.0 is not available/,
    );
    expect(() => selectSourceEntry(index, { id: "demo-bot", target: OTHER_TARGET })).toThrow(
      new RegExp(`Unsupported target "${OTHER_TARGET}" for source package "demo-bot"`),
    );
  });
});

describe("loadSourceIndex", () => {
  test("loads from a local file and names the location on read errors", async () => {
    const dir = tempDir();
    const path = join(dir, "gateway-source-index.json");
    writeFileSync(path, indexText([rawEntry()]));

    const index = await loadSourceIndex(path);
    expect(index.entries).toHaveLength(1);

    await expect(loadSourceIndex(join(dir, "missing.json"))).rejects.toThrow(/missing\.json/);
  });

  test("loads over HTTP, rejects non-2xx responses, and enforces maxBytes", async () => {
    const body = indexText([rawEntry()]);
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/missing") return new Response("not found", { status: 404 });
        if (path === "/large") return new Response("x".repeat(64));
        if (path === "/stream-large") {
          return new Response(new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("x".repeat(32)));
              controller.close();
            },
          }));
        }
        return new Response(body, { headers: { "content-type": "application/json" } });
      },
    });

    try {
      const location = (path: string) => new URL(path, server.url).toString();
      const index = await loadSourceIndex(location("gateway-source-index.json"));
      expect(index.entries).toHaveLength(1);

      await expect(loadSourceIndex(location("missing"))).rejects.toThrow(/HTTP 404/);
      await expect(loadSourceIndex(location("large"), { maxBytes: 16 })).rejects.toThrow(
        /exceeds 16 bytes/,
      );
      await expect(loadSourceIndex(location("stream-large"), { maxBytes: 16 })).rejects.toThrow(
        /exceeds 16 bytes/,
      );
    } finally {
      server.stop(true);
    }
  });

  test("rejects public plain HTTP before fetching and allows loopback HTTP", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return Response.json({ version: 1, entries: [] });
    }) as unknown as typeof fetch;

    await expect(loadSourceIndex("http://example.invalid/index.json", { fetchImpl }))
      .rejects.toThrow("Source URL must use HTTPS or loopback HTTP");
    expect(calls).toBe(0);

    await expect(loadSourceIndex("https://example.invalid/index.json", { fetchImpl }))
      .resolves.toMatchObject({ version: 1 });
    expect(calls).toBe(1);

    await expect(loadSourceIndex("http://127.0.0.1/index.json", { fetchImpl }))
      .resolves.toMatchObject({ version: 1 });
    expect(calls).toBe(2);
  });
});

describe("createSourceIndexEntry", () => {
  test("hashes archive bytes, normalizes the base URL, and round-trips the index", async () => {
    const dir = tempDir();
    const archivePath = join(dir, "echo-bot-1.0.0.tar.gz");
    const bytes = Buffer.from("echo-bot archive bytes");
    writeFileSync(archivePath, bytes);

    const created = await createSourceIndexEntry({
      archivePath,
      baseUrl: "https://example.invalid/releases///",
      id: "echo-bot",
      version: "1.0.0",
      target: HOST,
    });

    expect(created).toEqual({
      id: "echo-bot",
      version: "1.0.0",
      target: HOST,
      url: `https://example.invalid/releases/${basename(archivePath)}`,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.byteLength,
    });

    const parsed = parseSourceIndex(
      JSON.stringify(sourceIndexDocument([created])),
      "gateway-source-index.json",
    );
    expect(parsed.entries).toEqual([created]);
  });
});
