/** Bounded Telegram credential diagnostics; never exposes the bot token. */

const MAX_DETAIL_LENGTH = 200;
const GET_ME_TIMEOUT_MS = 5_000;

export type TelegramDiagnostic = { name: string; ok: boolean; at: string; detail?: string };

type GetMePayload = {
  ok?: boolean;
  result?: { username?: string };
  description?: string;
};

export async function readTelegramDiagnostics(
  botToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; checks: TelegramDiagnostic[] }> {
  const check: TelegramDiagnostic = { name: "telegram.getMe", ok: false, at: new Date().toISOString() };

  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${botToken}/getMe`, {
      signal: AbortSignal.timeout(GET_ME_TIMEOUT_MS),
    });
    const payload = await res.json().catch(() => undefined) as GetMePayload | undefined;
    check.ok = res.ok && payload?.ok === true;
    if (!check.ok) {
      check.detail = redact(payload?.description ?? `HTTP ${res.status}`, botToken);
    }
  } catch {
    check.detail = "network error";
  }

  return { ok: check.ok, checks: [check] };
}

function redact(text: string, botToken: string): string {
  return text.replaceAll(botToken, "[redacted]").slice(0, MAX_DETAIL_LENGTH);
}
