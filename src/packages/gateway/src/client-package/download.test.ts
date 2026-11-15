import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadVerifiedArtifact } from "./download";

const tempDirs: string[] = [];
const servers: Array<{ stop: (force?: boolean) => void }> = [];

function tempParent(): string {
  const dir = mkdtempSync(join(tmpdir(), "atom-download-test-"));
  tempDirs.push(dir);
  return dir;
}

function payload(size = 256): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(size);
  for (let index = 0; index < size; index++) data[index] = (index * 31 + 7) % 256;
  return data;
}

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Start a local server and return an artifact URL; every server is stopped in afterEach. */
function serve(fetch: () => Response | Promise<Response>): string {
  const server = Bun.serve({ port: 0, fetch });
  servers.push(server);
  return `http://127.0.0.1:${server.port}/artifact.tar.gz`;
}

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("downloadVerifiedArtifact", () => {
  test("downloads, verifies hash and size, and cleans up", async () => {
    const data = payload(512);
    const expected = sha256(data);
    const url = serve(() => new Response(data));
    const parent = tempParent();

    const artifact = await downloadVerifiedArtifact(
      { url, sha256: expected, size: data.byteLength },
      { tempDir: parent },
    );

    const [dir] = readdirSync(parent);
    expect(artifact.path).toBe(join(parent, dir!, "artifact.tar.gz"));
    expect(existsSync(artifact.path)).toBe(true);
    expect(artifact.sha256).toBe(expected);
    expect(artifact.size).toBe(data.byteLength);
    expect(readFileSync(artifact.path).equals(Buffer.from(data))).toBe(true);
    expect(statSync(artifact.path).mode & 0o777).toBe(0o600);
    expect(readdirSync(parent)).toEqual([dir!]);

    artifact.cleanup();
    expect(existsSync(artifact.path)).toBe(false);
    expect(readdirSync(parent)).toEqual([]);

    artifact.cleanup();
    expect(readdirSync(parent)).toEqual([]);
  });

  test("rejects public plain HTTP before fetching or creating temp files", async () => {
    let calls = 0;
    const parent = tempParent();
    const fetchImpl = (async () => {
      calls++;
      return new Response(payload());
    }) as unknown as typeof fetch;

    await expect(downloadVerifiedArtifact(
      { url: "http://example.invalid/artifact.tar.gz", sha256: sha256(payload()) },
      { fetchImpl, tempDir: parent },
    )).rejects.toThrow("Source URL must use HTTPS or loopback HTTP");
    expect(calls).toBe(0);
    expect(readdirSync(parent)).toEqual([]);
  });

  test("rejects a checksum mismatch and removes the temp directory", async () => {
    const data = payload();
    const expected = "f".repeat(64);
    const url = serve(() => new Response(data));
    const parent = tempParent();

    await expect(
      downloadVerifiedArtifact({ url, sha256: expected }, { tempDir: parent }),
    ).rejects.toThrow(`Checksum mismatch for ${url}: expected ${expected}, got ${sha256(data)}`);

    expect(readdirSync(parent)).toEqual([]);
  });

  test("rejects a non-2xx response", async () => {
    const url = serve(() => new Response("missing", { status: 404 }));
    const parent = tempParent();

    await expect(
      downloadVerifiedArtifact({ url, sha256: sha256(payload()) }, { tempDir: parent }),
    ).rejects.toThrow(`Download failed with HTTP 404 for ${url}`);

    expect(readdirSync(parent)).toEqual([]);
  });

  test("times out when the body stalls", async () => {
    const url = serve(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              setTimeout(() => {
                try {
                  controller.enqueue(payload(16));
                  controller.close();
                } catch {
                  // The client already aborted the stream.
                }
              }, 200);
            },
          }),
        ),
    );
    const parent = tempParent();

    await expect(
      downloadVerifiedArtifact(
        { url, sha256: sha256(payload(16)) },
        { timeoutMs: 30, tempDir: parent },
      ),
    ).rejects.toThrow("Download timed out after 30ms");

    expect(readdirSync(parent)).toEqual([]);
  });

  test("rejects when content-length exceeds maxBytes", async () => {
    const data = payload(256);
    const url = serve(() => new Response(data));
    const parent = tempParent();

    await expect(
      downloadVerifiedArtifact(
        { url, sha256: sha256(data) },
        { maxBytes: 64, tempDir: parent },
      ),
    ).rejects.toThrow(`Download exceeds maximum size of 64 bytes for ${url}`);

    expect(readdirSync(parent)).toEqual([]);
  });

  test("rejects when the streamed body exceeds maxBytes despite a smaller content-length", async () => {
    const data = payload(256);
    // A real Bun.serve response always gets a matching content-length, so use a
    // synthetic fetch response to exercise the streaming size guard.
    const fetchImpl = (async () =>
      new Response(data, { headers: { "content-length": "32" } })) as unknown as typeof fetch;
    const parent = tempParent();

    await expect(
      downloadVerifiedArtifact(
        { url: "http://127.0.0.1/artifact.tar.gz", sha256: sha256(data) },
        { fetchImpl, maxBytes: 64, tempDir: parent },
      ),
    ).rejects.toThrow("Download exceeds maximum size of 64 bytes for");

    expect(readdirSync(parent)).toEqual([]);
  });
});
