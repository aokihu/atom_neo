import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { Stats } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { create, extract, list } from "tar";
import type { ReadEntry } from "tar";
import { parseManifest, resolveEntry } from "./manifest";
import type { Manifest } from "./manifest";
import { findPackage, registerPackage } from "./registry";
import type { PackageRecord } from "./registry";

const TARGET_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const STAGE_PREFIX = "atom-client-pack-";
const INSTALL_TMP_PREFIX = "install-";
const FILE_ENTRY_TYPES = new Set(["File", "OldFile", "ContiguousFile"]);
const DIRECTORY_ENTRY_TYPES = new Set(["Directory", "GNUDumpDir"]);

export type PackOptions = {
  /** Output path. Relative paths resolve against process.cwd(); defaults to `<root>/dist/<id>-<version>-<target>.tar.gz`. */
  out?: string;
  target?: string;
};

export type InstallResult = PackageRecord;

type ArchiveEntry = {
  path: string;
  type: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hostTarget(): string {
  return `${process.platform}-${process.arch}`;
}

function failPack(root: string, message: string): never {
  throw new Error(`Cannot pack client ${root}: ${message}`);
}

function failInstall(archive: string, message: string): never {
  throw new Error(`Cannot install package from ${archive}: ${message}`);
}

function isSensitiveName(name: string): boolean {
  return name === ".env" || name.startsWith(".env.") || name.endsWith(".log");
}

/** Convert a production token to an archive-relative path, rejecting anything outside `bin/`. */
function normalizeBinPath(token: string): string {
  const path = token.replaceAll("\\", "/");
  if (isAbsolute(path) || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw new Error(`entry.production path must be relative and under bin/: ${token}`);
  }

  const segments = path.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.includes("..")) {
    throw new Error(`entry.production path must not contain "..": ${token}`);
  }
  if (segments[0] !== "bin" || segments.length < 2) {
    throw new Error(`entry.production path must be under bin/: ${token}`);
  }
  if (segments.some(isSensitiveName)) {
    throw new Error(`entry.production path must not reference an excluded file: ${token}`);
  }
  return segments.join("/");
}

function normalizeArchivePath(path: string): string {
  if (path === "") throw new Error("archive entry path is empty");
  if (path.includes("\0")) throw new Error("archive entry path contains a null byte");
  if (path.includes("\\")) throw new Error(`archive entry path contains a backslash: ${path}`);
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw new Error(`archive entry path must be relative: ${path}`);
  }

  const segments = path.split("/");
  if (segments.includes("..")) throw new Error(`archive entry path must not contain "..": ${path}`);
  const normalized = segments.filter((segment) => segment !== "" && segment !== ".").join("/");
  if (normalized === "") throw new Error(`archive entry path normalizes to empty: ${path}`);
  return normalized;
}

function archiveEntryKind(type: string): "file" | "directory" | undefined {
  if (FILE_ENTRY_TYPES.has(type)) return "file";
  if (DIRECTORY_ENTRY_TYPES.has(type)) return "directory";
  return undefined;
}

function assertProductionExecutable(root: string, token: string): string {
  let binPath: string;
  try {
    binPath = normalizeBinPath(token);
  } catch (error) {
    failPack(root, errorMessage(error));
  }

  const path = join(root, ...binPath.split("/"));
  const stat = lstat(root, path, `entry.production "${token}"`);
  if (stat.isSymbolicLink()) failPack(root, `entry.production "${token}" must not be a symlink`);
  if (!stat.isFile()) failPack(root, `entry.production "${token}" must be a regular file`);
  return binPath;
}

function readManifest(root: string): Manifest {
  const path = join(root, "manifest.json");
  try {
    return parseManifest(readFileSync(path, "utf-8"));
  } catch (error) {
    failPack(root, `${path}: ${errorMessage(error)}`);
  }
}

function resolveTarget(root: string, manifest: Manifest, requested?: string): string {
  const target = requested ?? manifest.target ?? hostTarget();
  if (!TARGET_PATTERN.test(target)) {
    failPack(root, `invalid target "${target}": expected lowercase letters, digits, or hyphens`);
  }
  if (manifest.target !== undefined && manifest.target !== target) {
    failPack(root, `manifest.target "${manifest.target}" does not match requested target "${target}"`);
  }
  return target;
}

function lstat(root: string, path: string, label: string): Stats {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      failPack(root, `${label} does not exist: ${path}`);
    }
    failPack(root, `cannot inspect ${label}: ${errorMessage(error)}`);
  }
}

function copyBinTree(root: string, source: string, destination: string, archivePath: string): void {
  mkdirSync(destination, { recursive: true });

  for (const name of readdirSync(source).sort()) {
    if (isSensitiveName(name)) continue;

    const sourcePath = join(source, name);
    const entryPath = `${archivePath}/${name}`;
    const stat = lstat(root, sourcePath, entryPath);

    if (stat.isSymbolicLink()) failPack(root, `cannot pack symlink ${entryPath}`);
    if (stat.isDirectory()) {
      copyBinTree(root, sourcePath, join(destination, name), entryPath);
    } else if (stat.isFile()) {
      const destinationPath = join(destination, name);
      copyFileSync(sourcePath, destinationPath);
      chmodSync(destinationPath, stat.mode & 0o777);
    } else {
      failPack(root, `cannot pack ${entryPath}: only regular files and directories are allowed`);
    }
  }
}

function collectBin(root: string, stage: string): void {
  const source = join(root, "bin");
  const stat = lstat(root, source, "bin");
  if (stat.isSymbolicLink()) failPack(root, "bin must not be a symlink");
  if (!stat.isDirectory()) failPack(root, "bin must be a directory");
  copyBinTree(root, source, join(stage, "bin"), "bin");
}

async function verifyArchive(file: string): Promise<void> {
  const entries: string[] = [];
  await list({
    file,
    onReadEntry: (entry) => {
      entries.push(entry.path.replace(/\/+$/, ""));
    },
  });

  if (!entries.includes("manifest.json")) {
    throw new Error(`${file}: archive is missing manifest.json`);
  }
  if (!entries.some((entry) => entry === "bin" || entry.startsWith("bin/"))) {
    throw new Error(`${file}: archive is missing bin/`);
  }
  const stray = entries.find(
    (entry) => entry !== "manifest.json" && entry !== "bin" && !entry.startsWith("bin/"),
  );
  if (stray !== undefined) {
    throw new Error(`${file}: archive entry ${stray} is outside the pack whitelist`);
  }
}

/**
 * Pack a client directory into `<id>-<version>-<target>.tar.gz`.
 * Only `manifest.json` and `bin/**` are included; the staged manifest records the resolved target.
 */
export async function packClient(root: string, options: PackOptions = {}): Promise<string> {
  const clientRoot = resolve(root);
  const manifest = readManifest(clientRoot);
  const target = resolveTarget(clientRoot, manifest, options.target);

  let production: readonly string[];
  try {
    production = resolveEntry(manifest, "package");
  } catch (error) {
    failPack(clientRoot, errorMessage(error));
  }
  const executable = assertProductionExecutable(clientRoot, production[0]!);

  const out = options.out === undefined
    ? join(clientRoot, "dist", `${manifest.id}-${manifest.version}-${target}.tar.gz`)
    : resolve(options.out);
  const outDir = dirname(out);

  let stage: string | undefined;
  let tempArchive: string | undefined;
  try {
    stage = mkdtempSync(join(tmpdir(), STAGE_PREFIX));
    writeFileSync(join(stage, "manifest.json"), `${JSON.stringify({ ...manifest, target }, null, 2)}\n`);
    collectBin(clientRoot, stage);

    if (!lstatSync(join(stage, ...executable.split("/"))).isFile()) {
      throw new Error(`production executable ${executable} was not staged`);
    }

    mkdirSync(outDir, { recursive: true });
    tempArchive = join(outDir, `.${basename(out)}.${randomUUID()}.tmp`);
    await create({ gzip: true, cwd: stage, file: tempArchive, portable: true }, ["manifest.json", "bin"]);
    await verifyArchive(tempArchive);

    renameSync(tempArchive, out);
    tempArchive = undefined;
    return out;
  } finally {
    if (stage !== undefined) rmSync(stage, { recursive: true, force: true });
    if (tempArchive !== undefined) rmSync(tempArchive, { force: true });
  }
}


function validateArchiveEntries(archive: string, entries: readonly ArchiveEntry[]): Set<string> {
  const allowed = new Set<string>();
  let manifestCount = 0;

  for (const entry of entries) {
    let path: string;
    try {
      path = normalizeArchivePath(entry.path);
    } catch (error) {
      failInstall(archive, errorMessage(error));
    }

    if (allowed.has(path)) failInstall(archive, `duplicate archive entry: ${entry.path}`);
    if (path.split("/").some(isSensitiveName)) {
      failInstall(archive, `archive entry references an excluded file: ${entry.path}`);
    }
    const kind = archiveEntryKind(entry.type);
    if (kind === undefined) {
      failInstall(archive, `archive entry type ${entry.type} is not allowed: ${entry.path}`);
    }

    if (path === "manifest.json") {
      if (kind !== "file") failInstall(archive, "manifest.json must be a regular file");
      manifestCount++;
    } else if (path === "bin") {
      if (kind !== "directory") failInstall(archive, "bin must be a directory");
    } else if (!path.startsWith("bin/")) {
      failInstall(archive, `archive entry is outside the pack whitelist: ${entry.path}`);
    }
    allowed.add(path);
  }

  if (manifestCount !== 1) failInstall(archive, "archive is missing manifest.json");
  return allowed;
}

async function readArchiveEntries(archivePath: string, source: string): Promise<Set<string>> {
  const entries: ArchiveEntry[] = [];
  try {
    await list({
      file: archivePath,
      strict: true,
      onReadEntry: (entry) => {
        if (!entry.meta) entries.push({ path: entry.path, type: entry.type });
      },
    });
  } catch (error) {
    failInstall(source, `cannot read archive: ${errorMessage(error)}`);
  }
  return validateArchiveEntries(source, entries);
}

async function extractArchive(
  archivePath: string,
  source: string,
  cwd: string,
  allowed: ReadonlySet<string>,
): Promise<void> {
  try {
    await extract({
      file: archivePath,
      cwd,
      strict: true,
      preservePaths: false,
      filter: (path, entry) => {
        const type = (entry as ReadEntry).type;
        return allowed.has(normalizeArchivePath(path)) && archiveEntryKind(type) !== undefined;
      },
    });
  } catch (error) {
    failInstall(source, `cannot extract archive: ${errorMessage(error)}`);
  }
}

function lstatInstall(archive: string, path: string, label: string): Stats {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      failInstall(archive, `${label} does not exist: ${path}`);
    }
    failInstall(archive, `cannot inspect ${label}: ${errorMessage(error)}`);
  }
}

function walkExtractedTree(archive: string, root: string): string[] {
  const files: string[] = [];

  const walk = (directory: string, prefix: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const relativePath = prefix === "" ? name : `${prefix}/${name}`;
      const stat = lstatInstall(archive, path, relativePath);

      if (stat.isSymbolicLink()) {
        failInstall(archive, `extracted package contains a symlink: ${relativePath}`);
      }
      if (stat.isDirectory()) {
        walk(path, relativePath);
      } else if (stat.isFile()) {
        files.push(relativePath);
      } else {
        failInstall(archive, `extracted package contains an unsupported entry: ${relativePath}`);
      }
    }
  };

  walk(root, "");
  return files.sort();
}

function readExtractedManifest(archive: string, root: string): Manifest {
  const path = join(root, "manifest.json");
  try {
    return parseManifest(readFileSync(path, "utf-8"));
  } catch (error) {
    failInstall(archive, `${path}: ${errorMessage(error)}`);
  }
}

function assertInstallableManifest(archive: string, root: string, manifest: Manifest): void {
  const target = hostTarget();
  if (manifest.target === undefined) failInstall(archive, "manifest.target is required");
  if (manifest.target !== target) {
    failInstall(archive, `unsupported package target "${manifest.target}"; this host is ${target}`);
  }

  let production: readonly string[];
  try {
    production = resolveEntry(manifest, "package");
  } catch (error) {
    failInstall(archive, errorMessage(error));
  }

  let binPath: string;
  try {
    binPath = normalizeBinPath(production[0]!);
  } catch (error) {
    failInstall(archive, errorMessage(error));
  }

  const executable = join(root, ...binPath.split("/"));
  const stat = lstatInstall(archive, executable, `entry.production "${production[0]}"`);
  if (stat.isSymbolicLink()) {
    failInstall(archive, `entry.production "${production[0]}" must not be a symlink`);
  }
  if (!stat.isFile()) {
    failInstall(archive, `entry.production "${production[0]}" must be a regular file`);
  }

  let rootReal: string;
  let executableReal: string;
  try {
    rootReal = realpathSync(root);
    executableReal = realpathSync(executable);
  } catch (error) {
    failInstall(archive, `cannot resolve entry.production "${production[0]}": ${errorMessage(error)}`);
  }
  if (executableReal !== rootReal && !executableReal.startsWith(`${rootReal}${sep}`)) {
    failInstall(archive, `entry.production "${production[0]}" resolves outside the package root`);
  }
}

/** Hash sorted relative paths and file bytes so archive metadata/gzip differences do not matter. */
function payloadSha256(root: string, files: readonly string[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort()) {
    const data = readFileSync(join(root, ...file.split("/")));
    hash.update(file, "utf8");
    hash.update("\0");
    hash.update(String(data.byteLength), "utf8");
    hash.update("\0");
    hash.update(data);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function lstatOptional(archive: string, path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    failInstall(archive, `cannot inspect ${path}: ${errorMessage(error)}`);
  }
}

function registryRelativePath(sandbox: string, path: string): string {
  return relative(sandbox, path).split(sep).join("/");
}

function commitPackage(
  sandbox: string,
  source: string,
  tempRoot: string,
  manifest: Manifest,
  target: string,
  sha256: string,
): PackageRecord {
  const finalDir = join(sandbox, ".atom", "gateway", "packages", manifest.id, manifest.version, target);
  const existing = findPackage(sandbox, manifest.id, manifest.version);
  const stat = lstatOptional(source, finalDir);

  if (stat !== undefined) {
    if (!stat.isDirectory()) {
      failInstall(source, `package path exists and is not a directory: ${finalDir}`);
    }
    if (existing !== undefined) {
      if (existing.sha256 === sha256) return existing;
      failInstall(source, `Package ${manifest.id}@${manifest.version} is already installed with different content`);
    }
    failInstall(source, `Package ${manifest.id}@${manifest.version} already exists at ${finalDir}; refusing to overwrite`);
  }

  if (existing !== undefined) {
    failInstall(
      source,
      `Package ${manifest.id}@${manifest.version} is registered but its package directory is missing: ${finalDir}`,
    );
  }

  mkdirSync(dirname(finalDir), { recursive: true });
  try {
    renameSync(tempRoot, finalDir);
  } catch (error) {
    failInstall(source, `cannot commit package ${manifest.id}@${manifest.version}: ${errorMessage(error)}`);
  }

  try {
    return registerPackage(sandbox, {
      id: manifest.id,
      version: manifest.version,
      target,
      path: registryRelativePath(sandbox, finalDir),
      source,
      sha256,
    });
  } catch (error) {
    rmSync(finalDir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Validate and install one client archive into `<sandbox>/.atom/gateway/packages/<id>/<version>/<target>`.
 * No shell tar; extraction happens only after every archive entry passes the pack whitelist.
 */
export async function installClient(sandbox: string, archive: string): Promise<InstallResult> {
  const sandboxRoot = resolve(sandbox);
  const archivePath = resolve(archive);
  const allowed = await readArchiveEntries(archivePath, archive);

  const tempParent = join(sandboxRoot, ".atom", "gateway", "tmp");
  mkdirSync(tempParent, { recursive: true });
  const tempRoot = mkdtempSync(join(tempParent, INSTALL_TMP_PREFIX));
  try {
    await extractArchive(archivePath, archive, tempRoot, allowed);
    const files = walkExtractedTree(archive, tempRoot);
    const manifest = readExtractedManifest(archive, tempRoot);
    assertInstallableManifest(archive, tempRoot, manifest);
    const sha256 = payloadSha256(tempRoot, files);
    return commitPackage(sandboxRoot, archive, tempRoot, manifest, hostTarget(), sha256);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}
