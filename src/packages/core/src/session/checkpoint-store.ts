import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type { PersistedSessionState } from "./types";
import {
  CHECKPOINT_FILES,
  GENERATION_PATTERN,
  sessionDirectoryPath,
  type CheckpointFilename,
} from "./session-format";
import { fsyncDirectory, writeDurable } from "./durable-fs";

export type CheckpointLocation = {
  directory: string;
  generation: string | null;
};

export class CheckpointStore {
  readonly #sessionsDir: string;

  constructor(sessionsDir: string) {
    this.#sessionsDir = sessionsDir;
    mkdirSync(this.#sessionsDir, { recursive: true, mode: 0o700 });
  }

  getSessionDirectory(sessionId: string, create = true): string {
    const dir = sessionDirectoryPath(this.#sessionsDir, sessionId);
    if (create) mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  }

  listSessionDirectories(): string[] {
    return readdirSync(this.#sessionsDir, { withFileTypes: true })
      .filter(dir => dir.isDirectory())
      .map(dir => resolve(this.#sessionsDir, dir.name));
  }

  resolveCheckpoint(sessionId: string): CheckpointLocation {
    const dir = this.getSessionDirectory(sessionId, false);
    const generation = this.resolveCurrentGeneration(dir);
    return { directory: generation ?? dir, generation };
  }

  readSessionState(dir: string): PersistedSessionState | null {
    const path = resolve(dir, "session.json");
    if (!existsSync(path)) return null;
    const state = JSON.parse(readFileSync(path, "utf8")) as PersistedSessionState;
    if (state.schemaVersion !== 1) throw new Error(`Unsupported session schema: ${state.schemaVersion}`);
    return state;
  }

  commit(sessionDir: string, revision: number, files: Record<CheckpointFilename, string>): string {
    const generation = this.writeGeneration(sessionDir, revision, files);
    this.publishGeneration(sessionDir, generation);
    this.cleanupGenerations(sessionDir, generation);
    return generation;
  }

  removeSession(sessionId: string): void {
    rmSync(this.getSessionDirectory(sessionId, false), { recursive: true, force: true });
  }

  writeGeneration(
    sessionDir: string,
    revision: number,
    files: Record<CheckpointFilename, string>,
  ): string {
    const checkpointsDir = resolve(sessionDir, ".checkpoints");
    mkdirSync(checkpointsDir, { recursive: true, mode: 0o700 });
    const generation = `g-${String(revision).padStart(12, "0")}-${randomUUID()}`;
    const temporary = resolve(checkpointsDir, `.${generation}.tmp`);
    const target = resolve(checkpointsDir, generation);
    mkdirSync(temporary, { mode: 0o700 });
    try {
      for (const filename of CHECKPOINT_FILES) {
        writeDurable(resolve(temporary, filename), files[filename]);
      }
      fsyncDirectory(temporary);
      renameSync(temporary, target);
      fsyncDirectory(checkpointsDir);
      return generation;
    } catch (error) {
      rmSync(temporary, { recursive: true, force: true });
      throw error;
    }
  }

  publishGeneration(sessionDir: string, generation: string): void {
    const temporary = resolve(sessionDir, `.current-${randomUUID()}.tmp`);
    try {
      symlinkSync(`.checkpoints/${generation}`, temporary, "dir");
      renameSync(temporary, resolve(sessionDir, "current"));
      fsyncDirectory(sessionDir);
    } finally {
      rmSync(temporary, { force: true });
    }

    try {
      for (const filename of CHECKPOINT_FILES) {
        const facade = resolve(sessionDir, filename);
        if (existsSync(facade) && lstatSync(facade).isSymbolicLink()
          && readlinkSync(facade) === `current/${filename}`) continue;
        const link = resolve(sessionDir, `.${filename}.${randomUUID()}.tmp`);
        try {
          symlinkSync(`current/${filename}`, link, "file");
          renameSync(link, facade);
        } finally {
          rmSync(link, { force: true });
        }
      }
      fsyncDirectory(sessionDir);
    } catch {
      // `current` is already committed; the next checkpoint repairs compatibility links.
    }
  }

  resolveCurrentGeneration(sessionDir: string): string | null {
    const current = resolve(sessionDir, "current");
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (!stat.isSymbolicLink()) throw new Error("Invalid session checkpoint pointer");
    const target = resolve(sessionDir, readlinkSync(current));
    const checkpointsDir = resolve(sessionDir, ".checkpoints");
    if (dirname(target) !== checkpointsDir || !GENERATION_PATTERN.test(basename(target))) {
      throw new Error("Invalid session checkpoint pointer");
    }
    if (!existsSync(target) || !lstatSync(target).isDirectory()) {
      throw new Error("Session checkpoint generation is missing");
    }
    return target;
  }

  cleanupGenerations(sessionDir: string, current: string): void {
    const checkpointsDir = resolve(sessionDir, ".checkpoints");
    try {
      const generations = readdirSync(checkpointsDir)
        .filter(name => GENERATION_PATTERN.test(name))
        .toSorted()
        .reverse();
      const keep = new Set([current, generations.find(name => name !== current)].filter(Boolean));
      for (const name of readdirSync(checkpointsDir)) {
        if (keep.has(name)) continue;
        if (GENERATION_PATTERN.test(name) || /^\.g-.*\.tmp$/.test(name)) {
          rmSync(resolve(checkpointsDir, name), { recursive: true, force: true });
        }
      }
      fsyncDirectory(checkpointsDir);
    } catch {
      // A committed checkpoint remains valid even if old-generation cleanup fails.
    }
  }
}
