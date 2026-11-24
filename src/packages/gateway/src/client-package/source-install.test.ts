import { afterEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packClient } from "./archive";
import type { DownloadArtifact } from "./download";
import { findPackage } from "./registry";
import type { SourceIndexEntry } from "./source-index";
import { sourceIndexDocument } from "./source-index";
import { installSourcePackage } from "./source-install";

const HOST = `${process.platform}-${process.arch}`;
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "atom-source-install-test-"));
  tempDirs.push(dir);
  return dir;
}

function createClient(version: string): string {
  const root = tempDir();
  mkdirSync(join(root, "bin"), { recursive: true });
  writeFileSync(
    join(root, "manifest.json"),
    JSON.stringify({
      manifest_version: 1,
      id: "demo-bot",
      name: "Demo Bot",
      version,
      platform: "demo",
      entry: { production: ["./bin/demo-bot"] },
    }),
  );
  writeFileSync(join(root, "bin", "demo-bot"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return root;
}

async function archiveFor(version: string): Promise<string> {
  return packClient(createClient(version), { out: join(tempDir(), `demo-bot-${version}.tar.gz`) });
}

function entry(version: string): SourceIndexEntry {
  return {
    id: "demo-bot",
    version,
    target: HOST,
    url: `https://example.invalid/demo-bot-${version}.tar.gz`,
    sha256: "a".repeat(64),
    size: 128,
  };
}

function writeIndex(entries: readonly SourceIndexEntry[]): string {
  const path = join(tempDir(), "gateway-source-index.json");
  writeFileSync(path, JSON.stringify(sourceIndexDocument(entries)));
  return path;
}

/** Injected downloader that maps entry URLs to prebuilt archives and records calls. */
function downloadOf(
  paths: ReadonlyMap<string, string>,
  cleanup: () => void,
  downloads: DownloadArtifact[],
): (artifact: DownloadArtifact) => Promise<{
  path: string;
  sha256: string;
  size: number;
  cleanup: () => void;
}> {
  return async (artifact) => {
    downloads.push(artifact);
    const path = paths.get(artifact.url);
    if (path === undefined) throw new Error(`Unexpected download: ${artifact.url}`);
    return { path, sha256: artifact.sha256, size: artifact.size ?? 0, cleanup };
  };
}

describe("installSourcePackage", () => {
  test("installs an archive, records the source URL, and reuses the installed version", async () => {
    const archive = await archiveFor("1.0.0");
    const selected = entry("1.0.0");
    const source = writeIndex([selected]);
    const sandbox = tempDir();
    const downloads: DownloadArtifact[] = [];
    const cleanup = mock(() => {});
    const download = downloadOf(new Map([[selected.url, archive]]), cleanup, downloads);

    const result = await installSourcePackage(sandbox, "demo-bot", {
      source,
      version: "1.0.0",
      download,
    });

    expect(result.cached).toBe(false);
    expect(result.entry).toEqual(selected);
    expect(result.record).toMatchObject({
      target: HOST,
      source: selected.url,
      path: join(".atom", "gateway", "packages", "demo-bot", "1.0.0", HOST),
    });
    expect(findPackage(sandbox, "demo-bot", "1.0.0")).toEqual(result.record);
    expect(existsSync(join(sandbox, result.record.path, "manifest.json"))).toBe(true);
    expect(downloads).toEqual([{ url: selected.url, sha256: selected.sha256, size: selected.size }]);
    expect(cleanup).toHaveBeenCalledTimes(1);

    const cached = await installSourcePackage(sandbox, "demo-bot", { version: "1.0.0" });
    expect(cached).toEqual({ record: result.record, cached: true });
    expect(downloads).toHaveLength(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test("selects the latest host version when version is omitted", async () => {
    const entries = [entry("1.0.0"), entry("2.0.0")];
    const paths = new Map<string, string>();
    for (const item of entries) paths.set(item.url, await archiveFor(item.version));
    const source = writeIndex(entries);
    const sandbox = tempDir();
    const downloads: DownloadArtifact[] = [];
    const cleanup = mock(() => {});
    const download = downloadOf(paths, cleanup, downloads);

    const result = await installSourcePackage(sandbox, "demo-bot", { source, download });

    expect(result.cached).toBe(false);
    expect(result.entry).toEqual(entries[1]!);
    expect(downloads.map((artifact) => artifact.url)).toEqual([entries[1]!.url]);
    expect(findPackage(sandbox, "demo-bot", "2.0.0")).toEqual(result.record);
    expect(findPackage(sandbox, "demo-bot", "1.0.0")).toBeUndefined();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test("rejects a missing source when the requested version is not installed", async () => {
    await expect(installSourcePackage(tempDir(), "demo-bot", { version: "1.0.0" })).rejects.toThrow(
      "Source index is required to install demo-bot@1.0.0",
    );
    await expect(installSourcePackage(tempDir(), "demo-bot")).rejects.toThrow(
      "Source index is required to install demo-bot",
    );
  });

  test("cleans up the download when installation fails", async () => {
    const selected = entry("1.0.0");
    const source = writeIndex([selected]);
    const sandbox = tempDir();
    const cleanup = mock(() => {});
    const download = downloadOf(
      new Map([[selected.url, join(sandbox, "missing.tar.gz")]]),
      cleanup,
      [],
    );

    await expect(installSourcePackage(sandbox, "demo-bot", { source, download })).rejects.toThrow();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(findPackage(sandbox, "demo-bot", "1.0.0")).toBeUndefined();
  });
});
