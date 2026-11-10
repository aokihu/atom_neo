/**
 * Archive codec tests: round-trip, encryption and tamper detection.
 */
import { describe, expect, test } from "bun:test";
import { decodeBackup, encodeBackup, inspectBackup } from "./backup-format";

const bundle = {
  "config.json": '{\n  "version": 2\n}\n',
  ".env": "DEEPSEEK_API_KEY=sk-test\nOPENAI_API_KEY=sk-another\n",
};

function envelope(text: string): any {
  return JSON.parse(text);
}

describe("backup archive format", () => {
  test("round-trips an unencrypted archive", () => {
    const text = encodeBackup(bundle, { appVersion: "test" });
    const decoded = decodeBackup(text);
    expect(decoded.encrypted).toBe(false);
    expect(decoded.bundle).toEqual(bundle);
    expect(inspectBackup(text)).toMatchObject({ encrypted: false, appVersion: "test", version: 1 });
  });

  test("round-trips an encrypted archive", () => {
    const text = encodeBackup(bundle, { appVersion: "test", password: "correct-horse" });
    expect(inspectBackup(text).encrypted).toBe(true);
    expect(decodeBackup(text, "correct-horse").bundle).toEqual(bundle);
  });

  test("rejects a missing or wrong password", () => {
    const text = encodeBackup(bundle, { appVersion: "test", password: "correct-horse" });
    expect(() => decodeBackup(text)).toThrow("password is required");
    expect(() => decodeBackup(text, "wrong-password")).toThrow("wrong password");
  });

  test("rejects a tampered encrypted payload", () => {
    const text = encodeBackup(bundle, { appVersion: "test", password: "correct-horse" });
    const archive = envelope(text);
    archive.payload = `${archive.payload[0] === "A" ? "B" : "A"}${archive.payload.slice(1)}`;
    expect(() => decodeBackup(JSON.stringify(archive), "correct-horse")).toThrow();
  });

  test("rejects a checksum mismatch", () => {
    const text = encodeBackup(bundle, { appVersion: "test" });
    const archive = envelope(text);
    archive.files[0].sha256 = "0".repeat(64);
    expect(() => decodeBackup(JSON.stringify(archive))).toThrow("checksum mismatch");
  });

  test("rejects an unknown version and format", () => {
    const archive = envelope(encodeBackup(bundle, { appVersion: "test" }));
    expect(() => decodeBackup(JSON.stringify({ ...archive, version: 2 }))).toThrow("Unsupported backup version");
    expect(() => decodeBackup(JSON.stringify({ ...archive, format: "other" }))).toThrow("unsupported format");
  });

  test("rejects unknown files and archives without config", () => {
    expect(() => encodeBackup({ "other.txt": "x" } as any, { appVersion: "test" })).toThrow("unknown file");
    expect(() => encodeBackup({ ".env": "A=1\n" }, { appVersion: "test" })).toThrow("config.json is required");
  });
});
