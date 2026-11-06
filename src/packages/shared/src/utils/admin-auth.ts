type IpResolver = { requestIP(req: Request): { address: string } | null };

const LOOPBACK_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** Remote management is opt-in; every request still requires the shared token. */
export function isAdminRequest(req: Request, srv: IpResolver, adminToken?: string, allowRemote = false): boolean {
  if (!adminToken || req.headers.get("x-atom-admin-token") !== adminToken) return false;
  const ip = srv.requestIP(req)?.address ?? "";
  return LOOPBACK_IPS.has(ip) || (allowRemote && ip !== "");
}
