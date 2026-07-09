// @atom-neo/gateway - Barrel exports
export { startGateway } from "./server";
export { loadGatewayConfig } from "./config";
export type { GatewayConfig, ClientConfig } from "./config";
export { JwtVerifier } from "./auth/jwt";
export type { JwtPayload } from "./auth/jwt";
export { generateSecret, verifySecret, withSecretHeader, SECRET_HEADER } from "./auth/secret";
export { checkPermission, PermissionLevel } from "./permissions/checker";
export { RateLimiter } from "./ratelimit/limiter";
export { CoreProxy } from "./proxy/core-proxy";
export { ClientManager } from "./client-manager";
export type { ActiveClient } from "./client-manager";
