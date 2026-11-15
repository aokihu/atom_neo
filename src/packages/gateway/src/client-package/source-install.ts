import { installClient } from "./archive";
import { downloadVerifiedArtifact } from "./download";
import { findPackage } from "./registry";
import type { PackageRecord } from "./registry";
import type { SourceIndexEntry } from "./source-index";
import { loadSourceIndex, selectSourceEntry } from "./source-index";

export type SourceInstallOptions = {
  source?: string;
  version?: string;
  target?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  /** injectable for tests; defaults to downloadVerifiedArtifact */
  download?: typeof downloadVerifiedArtifact;
};

export type SourceInstallResult = {
  entry?: SourceIndexEntry;
  record: PackageRecord;
  cached: boolean;
};

function requestLabel(id: string, version?: string): string {
  return version === undefined ? id : `${id}@${version}`;
}

/**
 * Install one package version from a Gateway source index.
 *
 * An already-installed version is reused without loading the index or downloading.
 * Downloads are verified and always cleaned up, and installation reuses `installClient`
 * so there is no second extraction or registry path.
 */
export async function installSourcePackage(
  sandbox: string,
  id: string,
  options: SourceInstallOptions = {},
): Promise<SourceInstallResult> {
  if (options.version !== undefined) {
    const installed = findPackage(sandbox, id, options.version);
    if (installed !== undefined) return { record: installed, cached: true };
  }

  const source = options.source;
  if (source === undefined) {
    throw new Error(`Source index is required to install ${requestLabel(id, options.version)}`);
  }

  const index = await loadSourceIndex(source, {
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    maxBytes: options.maxBytes,
  });
  const entry = selectSourceEntry(index, {
    id,
    version: options.version,
    target: options.target,
  });

  const installed = findPackage(sandbox, id, entry.version);
  if (installed !== undefined) return { entry, record: installed, cached: true };

  const download = options.download ?? downloadVerifiedArtifact;
  const downloaded = await download(
    { url: entry.url, sha256: entry.sha256, size: entry.size },
    { fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs, maxBytes: options.maxBytes },
  );

  try {
    const record = await installClient(sandbox, downloaded.path, { source: entry.url });
    return { entry, record, cached: false };
  } finally {
    downloaded.cleanup();
  }
}
