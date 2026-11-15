#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { packClient } from "../src/packages/gateway/src/client-package/archive";
import { parseManifest } from "../src/packages/gateway/src/client-package/manifest";
import {
  createSourceIndexEntry,
  sourceIndexDocument,
} from "../src/packages/gateway/src/client-package/source-index";

const DEFAULT_CLIENT = "clients/telegram-bot";
const DEFAULT_OUT = "dist/gateway";
const USAGE =
  "Usage: bun run scripts/gateway-release.ts [--client <dir>] [--base-url <url>] [--out <dir>] [--no-build]";

type ReleaseOptions = {
  client: string;
  out: string;
  baseUrl?: string;
  build: boolean;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseArgs(argv: readonly string[]): ReleaseOptions {
  const options: ReleaseOptions = { client: DEFAULT_CLIENT, out: DEFAULT_OUT, build: true };

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (token === "--no-build") {
      options.build = false;
      continue;
    }

    const separator = token.indexOf("=");
    const flag = separator === -1 ? token : token.slice(0, separator);
    if (flag !== "--client" && flag !== "--base-url" && flag !== "--out") {
      throw new Error(`Unknown argument: ${token}\n${USAGE}`);
    }

    let value = separator === -1 ? undefined : token.slice(separator + 1);
    if (value === undefined) {
      value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    }
    if (value === "") throw new Error(`${flag} requires a value`);

    if (flag === "--client") options.client = value;
    else if (flag === "--out") options.out = value;
    else options.baseUrl = value;
  }

  return options;
}

function buildClient(clientDir: string): void {
  const result = spawnSync("bun", ["run", "build"], { cwd: clientDir, stdio: "inherit" });
  if (result.error) {
    throw new Error(`Cannot build client in ${clientDir}: ${errorMessage(result.error)}`);
  }
  if (result.status !== 0) {
    const reason = result.status === null ? (result.signal ?? "unknown signal") : `exit ${result.status}`;
    throw new Error(`Client build failed in ${clientDir}: ${reason}`);
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const clientDir = resolve(options.client);
  const outDir = resolve(options.out);
  const baseUrl = (options.baseUrl ?? process.env.ATOM_GATEWAY_SOURCE_BASE_URL ?? "").trim();
  if (baseUrl === "") {
    throw new Error(`Missing required --base-url or ATOM_GATEWAY_SOURCE_BASE_URL\n${USAGE}`);
  }

  const manifestPath = join(clientDir, "manifest.json");
  let manifestText: string;
  try {
    manifestText = readFileSync(manifestPath, "utf8");
  } catch (error) {
    throw new Error(`Cannot read client manifest ${manifestPath}: ${errorMessage(error)}`);
  }
  const manifest = parseManifest(manifestText);

  const target = `${process.platform}-${process.arch}`;
  if (manifest.target !== undefined && manifest.target !== target) {
    throw new Error(
      `Client manifest target "${manifest.target}" does not match current host target "${target}"`,
    );
  }

  if (options.build) buildClient(clientDir);

  const archive = join(outDir, `${manifest.id}-${manifest.version}-${target}.tar.gz`);
  await packClient(clientDir, { out: archive, target });
  const entry = await createSourceIndexEntry({
    archivePath: archive,
    baseUrl,
    id: manifest.id,
    version: manifest.version,
    target,
  });
  const index = sourceIndexDocument([entry]);
  const indexPath = join(outDir, "gateway-source-index.json");
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);

  console.log(JSON.stringify({ archive, index: indexPath, entry }, null, 2));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`gateway-release: ${errorMessage(error)}`);
    process.exitCode = 1;
  });
}
