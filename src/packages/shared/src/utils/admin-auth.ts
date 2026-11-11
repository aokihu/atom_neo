/** Admin context is transport-agnostic: adapters resolve the peer IP, routes only compare it. */
export type AdminRequestContext = { readonly ip: string };

const LOOPBACK_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** Remote management is opt-in; every request still requires the shared token. */
export function isAdminRequest(req: Request, ctx: AdminRequestContext, adminToken?: string, allowRemote = false): boolean {
  if (!adminToken || req.headers.get("x-atom-admin-token") !== adminToken) return false;
  return LOOPBACK_IPS.has(ctx.ip) || (allowRemote && ctx.ip !== "");
}
