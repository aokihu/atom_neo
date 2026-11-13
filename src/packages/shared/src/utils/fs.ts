import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

export type WriteFileAtomicOptions = {
  mode?: number;
  fsync?: boolean;
  createDirs?: boolean;
};

/**
 * Write through a sibling temp file and rename, preserving the destination mode
 * (or `options.mode`) and cleaning the temp file on any failure.
 */
export function writeFileAtomic(path: string, data: string | Uint8Array, options: WriteFileAtomicOptions = {}): void {
  const preservedMode = options.mode ?? (existsSync(path) ? statSync(path).mode & 0o777 : undefined);
  const temporary = `${path}.tmp-${randomUUID()}`;
  let descriptor: number | undefined;
  try {
    if (options.createDirs !== false) mkdirSync(dirname(path), { recursive: true });
    descriptor = openSync(temporary, "wx", preservedMode ?? 0o666);
    writeFileSync(descriptor, data, "utf8");
    if (options.fsync) fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    if (preservedMode !== undefined) chmodSync(temporary, preservedMode);
    renameSync(temporary, path);
  } catch (error) {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* already closed */ }
    }
    rmSync(temporary, { force: true });
    throw error;
  }
}
