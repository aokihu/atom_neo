/**
 * .atombak archive codec: JSON envelope + gzip payload with optional AES-256-GCM.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

export const BACKUP_FORMAT = "atom-backup";
export const BACKUP_VERSION = 1;
export const BACKUP_EXTENSION = ".atombak";
export const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
export const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const SCRYPT_PARAMS = { n: 32768, r: 8, p: 1 } as const;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export const BACKUP_FILES = ["config.json", ".env"] as const;
export type BackupFileName = (typeof BACKUP_FILES)[number];
export type BackupBundle = Partial<Record<BackupFileName, string>>;

export type BackupFileEntry = { name: BackupFileName; size: number; sha256: string };
export type BackupEncryption = {
  alg: "aes-256-gcm";
  kdf: { name: "scrypt"; salt: string; n: number; r: number; p: number };
  iv: string;
  tag: string;
};
export type BackupEnvelope = {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  appVersion: string;
  files: BackupFileEntry[];
  encryption: BackupEncryption | null;
  payload: string;
};
export type BackupSummary = Pick<BackupEnvelope, "version" | "createdAt" | "appVersion" | "files"> & { encrypted: boolean };
export type DecodedBackup = BackupSummary & { bundle: BackupBundle };

function isBackupFileName(value: string): value is BackupFileName {
  return (BACKUP_FILES as readonly string[]).includes(value);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`Invalid backup: ${label} must be an object`);
  return value as Record<string, unknown>;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function decodeBase64(value: unknown, label: string): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error(`Invalid backup: ${label} is not valid base64`);
  }
  return Buffer.from(value, "base64");
}

function parseFileEntry(value: unknown): BackupFileEntry {
  const entry = asRecord(value, "files entry");
  if (typeof entry.name !== "string" || !isBackupFileName(entry.name)) throw new Error("Invalid backup: unknown file name");
  if (typeof entry.size !== "number" || !Number.isInteger(entry.size) || entry.size < 0) throw new Error(`Invalid backup: ${entry.name} has an invalid size`);
  if (typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256)) throw new Error(`Invalid backup: ${entry.name} has an invalid checksum`);
  return { name: entry.name, size: entry.size, sha256: entry.sha256 };
}

function parseEncryption(value: unknown): BackupEncryption {
  const encryption = asRecord(value, "encryption");
  const kdf = asRecord(encryption.kdf, "encryption.kdf");
  if (encryption.alg !== "aes-256-gcm" || kdf.name !== "scrypt") throw new Error("Invalid backup: unsupported encryption algorithm");
  if (kdf.n !== SCRYPT_PARAMS.n || kdf.r !== SCRYPT_PARAMS.r || kdf.p !== SCRYPT_PARAMS.p) throw new Error("Invalid backup: unsupported scrypt parameters");
  const salt = decodeBase64(kdf.salt, "salt");
  const iv = decodeBase64(encryption.iv, "iv");
  const tag = decodeBase64(encryption.tag, "tag");
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error("Invalid backup: malformed encryption metadata");
  return {
    alg: "aes-256-gcm",
    kdf: { name: "scrypt", salt: kdf.salt as string, n: kdf.n, r: kdf.r, p: kdf.p },
    iv: encryption.iv as string,
    tag: encryption.tag as string,
  };
}

function parseEnvelope(raw: unknown): BackupEnvelope {
  const envelope = asRecord(raw, "archive");
  if (envelope.format !== BACKUP_FORMAT) throw new Error("Invalid backup: unsupported format");
  if (envelope.version !== BACKUP_VERSION) throw new Error(`Unsupported backup version: ${String(envelope.version)}`);
  if (typeof envelope.createdAt !== "string" || Number.isNaN(Date.parse(envelope.createdAt))) throw new Error("Invalid backup: createdAt is invalid");
  if (typeof envelope.appVersion !== "string") throw new Error("Invalid backup: appVersion is invalid");
  if (!Array.isArray(envelope.files)) throw new Error("Invalid backup: files must be an array");
  const files = envelope.files.map(parseFileEntry);
  const names = new Set(files.map(file => file.name));
  if (names.size !== files.length) throw new Error("Invalid backup: duplicate file entries");
  if (typeof envelope.payload !== "string") throw new Error("Invalid backup: payload is invalid");
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: envelope.createdAt,
    appVersion: envelope.appVersion,
    files,
    encryption: envelope.encryption === null ? null : parseEncryption(envelope.encryption),
    payload: envelope.payload,
  };
}

function parseArchiveText(text: string): BackupEnvelope {
  if (Buffer.byteLength(text, "utf8") > MAX_ARCHIVE_BYTES) throw new Error("Invalid backup: archive is too large");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Invalid backup: archive is not valid JSON");
  }
  return parseEnvelope(raw);
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 32, { N: SCRYPT_PARAMS.n, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p, maxmem: SCRYPT_MAXMEM });
}

function encryptPayload(compressed: Buffer, password: string): { payload: Buffer; encryption: BackupEncryption } {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(password, salt), iv);
  const payload = Buffer.concat([cipher.update(compressed), cipher.final()]);
  return {
    payload,
    encryption: {
      alg: "aes-256-gcm",
      kdf: { name: "scrypt", salt: salt.toString("base64"), ...SCRYPT_PARAMS },
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    },
  };
}

function decryptPayload(payload: Buffer, password: string, encryption: BackupEncryption): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(password, decodeBase64(encryption.kdf.salt, "salt")), decodeBase64(encryption.iv, "iv"));
  decipher.setAuthTag(decodeBase64(encryption.tag, "tag"));
  try {
    return Buffer.concat([decipher.update(payload), decipher.final()]);
  } catch {
    throw new Error("Invalid backup: wrong password or corrupted payload");
  }
}

function readBundle(value: unknown): BackupBundle {
  const record = asRecord(value, "payload");
  const bundle: BackupBundle = {};
  for (const [name, content] of Object.entries(record)) {
    if (!isBackupFileName(name)) throw new Error(`Invalid backup: unexpected file ${name}`);
    if (typeof content !== "string") throw new Error(`Invalid backup: ${name} must be text`);
    if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) throw new Error(`Invalid backup: ${name} is too large`);
    bundle[name] = content;
  }
  if (bundle["config.json"] === undefined) throw new Error("Invalid backup: config.json is missing");
  return bundle;
}

function verifyManifest(files: BackupFileEntry[], bundle: BackupBundle): void {
  if (files.length !== Object.keys(bundle).length) throw new Error("Invalid backup: manifest does not match payload");
  for (const file of files) {
    const content = bundle[file.name];
    if (content === undefined) throw new Error(`Invalid backup: ${file.name} is missing from payload`);
    const bytes = Buffer.from(content, "utf8");
    if (bytes.length !== file.size || sha256(bytes) !== file.sha256) throw new Error(`Invalid backup: ${file.name} checksum mismatch`);
  }
}

export function encodeBackup(bundle: BackupBundle, options: { password?: string; appVersion: string }): string {
  for (const name of Object.keys(bundle)) if (!isBackupFileName(name)) throw new Error(`Cannot export unknown file: ${name}`);
  const files = BACKUP_FILES.flatMap(name => {
    const content = bundle[name];
    if (content === undefined) return [];
    const bytes = Buffer.from(content, "utf8");
    if (bytes.length > MAX_FILE_BYTES) throw new Error(`${name} is too large to export`);
    return [{ name, size: bytes.length, sha256: sha256(bytes) }];
  });
  if (bundle["config.json"] === undefined) throw new Error("config.json is required");
  const compressed = gzipSync(Buffer.from(JSON.stringify(bundle), "utf8"));
  const encrypted = options.password ? encryptPayload(compressed, options.password) : undefined;
  const envelope: BackupEnvelope = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    appVersion: options.appVersion,
    files,
    encryption: encrypted?.encryption ?? null,
    payload: (encrypted?.payload ?? compressed).toString("base64"),
  };
  if (Buffer.byteLength(envelope.payload, "utf8") > MAX_ARCHIVE_BYTES) throw new Error("Backup payload is too large");
  return JSON.stringify(envelope, null, 2) + "\n";
}

export function inspectBackup(text: string): BackupSummary {
  const envelope = parseArchiveText(text);
  return { version: envelope.version, createdAt: envelope.createdAt, appVersion: envelope.appVersion, files: envelope.files, encrypted: envelope.encryption !== null };
}

export function decodeBackup(text: string, password?: string): DecodedBackup {
  const envelope = parseArchiveText(text);
  if (envelope.encryption && !password) throw new Error("Backup is encrypted; password is required");
  const payload = decodeBase64(envelope.payload, "payload");
  const compressed = envelope.encryption ? decryptPayload(payload, password!, envelope.encryption) : payload;
  let json: Buffer;
  try {
    json = gunzipSync(compressed, { maxOutputLength: MAX_PAYLOAD_BYTES });
  } catch {
    throw new Error("Invalid backup: payload cannot be decompressed");
  }
  if (json.length > MAX_PAYLOAD_BYTES) throw new Error("Invalid backup: payload is too large");
  let raw: unknown;
  try {
    raw = JSON.parse(json.toString("utf8"));
  } catch {
    throw new Error("Invalid backup: payload is not valid JSON");
  }
  const bundle = readBundle(raw);
  verifyManifest(envelope.files, bundle);
  return { version: envelope.version, createdAt: envelope.createdAt, appVersion: envelope.appVersion, files: envelope.files, encrypted: envelope.encryption !== null, bundle };
}
