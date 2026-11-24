import { describe, expect, test } from "bun:test";
import { readTelegramDiagnostics } from "./diagnostics";

const TOKEN = "123456:AAH-secret-token";

describe("readTelegramDiagnostics", () => {
  test("reports getMe success without exposing the token", async () => {
    let requestedUrl = "";

    const result = await readTelegramDiagnostics(TOKEN, (async (url: string | URL | Request) => {
      requestedUrl = String(url);
      return Response.json({ ok: true, result: { username: "atom_test_bot" } });
    }) as unknown as typeof fetch);

    expect(requestedUrl).toBe(`https://api.telegram.org/bot${TOKEN}/getMe`);
    expect(result.ok).toBe(true);
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]).toMatchObject({ name: "telegram.getMe", ok: true });
    expect(Number.isNaN(Date.parse(result.checks[0]!.at))).toBe(false);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  test("reports API failure and redacts the token from details", async () => {
    const result = await readTelegramDiagnostics(TOKEN, (async () =>
      Response.json(
        { ok: false, error_code: 401, description: `Unauthorized ${TOKEN}` },
        { status: 401 },
      )) as unknown as typeof fetch);

    expect(result.ok).toBe(false);
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]).toMatchObject({ name: "telegram.getMe", ok: false });
    expect(result.checks[0]!.detail).toContain("[redacted]");
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  test("reports network failure without exposing the token", async () => {
    const result = await readTelegramDiagnostics(TOKEN, (async () => {
      throw new Error(`connect failed for ${TOKEN}`);
    }) as unknown as typeof fetch);

    expect(result).toEqual({
      ok: false,
      checks: [expect.objectContaining({ name: "telegram.getMe", ok: false, detail: "network error" })],
    });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});
