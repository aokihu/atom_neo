/** Gateway inbound submission with typed busy/rejected failures. */

const SECRET_HEADER = "X-Gateway-Secret";

export class GatewayBusyError extends Error {
  readonly status: 503 | 429;
  readonly retryAfterMs: number;

  constructor(status: 503 | 429, retryAfterMs: number) {
    super(`Gateway busy (${status})`);
    this.name = "GatewayBusyError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export class GatewayRejectedError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Gateway rejected inbound message (${status})`);
    this.name = "GatewayRejectedError";
    this.status = status;
  }
}

export async function submitInbound(input: {
  gatewayUrl: string;
  secret: string;
  platformUserId: string;
  text: string;
  fetchImpl?: typeof fetch;
}): Promise<Response> {
  const res = await (input.fetchImpl ?? fetch)(`${input.gatewayUrl}/gateway/inbound`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [SECRET_HEADER]: input.secret },
    body: JSON.stringify({
      type: "message",
      platform: "telegram",
      platformUserId: input.platformUserId,
      data: { text: input.text },
    }),
  });

  const status = res.status;
  if (status === 503 || status === 429) {
    throw new GatewayBusyError(status, readRetryAfterMs(res) ?? (status === 503 ? 1_000 : 2_000));
  }
  if (!res.ok) throw new GatewayRejectedError(status);
  return res;
}

function readRetryAfterMs(res: Response): number | undefined {
  const raw = res.headers.get("Retry-After");
  if (raw === null) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : undefined;
}
