// Attach credentials come from the selected instance or an explicit remote secret.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localUrl, publishRuntimeFile, readAttachToken } from "./runtime-file";

test("local attach prefers runtime credentials and remote attach requires an explicit token", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "atom-attach-token-"));
  try {
    publishRuntimeFile(sandbox, "core", { url: "http://127.0.0.1:3100", token: "local", instanceId: "test" });
    expect(readAttachToken(sandbox, "127.0.0.1", "remote")).toBe("local");
    expect(readAttachToken(sandbox, "192.168.1.20", "remote")).toBe("remote");
    expect(() => readAttachToken(sandbox, "192.168.1.20")).toThrow("ATOM_ADMIN_TOKEN");
    expect(localUrl("::1", 3100)).toBe("http://[::1]:3100");
  } finally { rmSync(sandbox, { recursive: true, force: true }); }
});
