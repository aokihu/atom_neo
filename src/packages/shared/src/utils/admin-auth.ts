type IpResolver = { requestIP(req: Request): { address: string } | null };

const LOOPBACK_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** Local management endpoints require: loopback source + shared admin token, anything else is rejected. */
export function isAdminRequest(req: Request, srv: IpResolver, adminToken?: string): boolean {
  if (!adminToken || req.headers.get("x-atom-admin-token") !== adminToken) return false;
  const ip = srv.requestIP(req)?.address ?? "";
  return LOOPBACK_IPS.has(ip);
}
