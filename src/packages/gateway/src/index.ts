// @atom-neo/gateway - Barrel exports
export { startGateway } from "./server";
export { loadGatewayConfig } from "./config";
export type { GatewayConfig, ClientConfig } from "./config";
export { generateSecret, verifySecret, withSecretHeader, SECRET_HEADER } from "./auth/secret";
export { ClientManager } from "./client-manager";
export type { ActiveClient } from "./client-manager";
