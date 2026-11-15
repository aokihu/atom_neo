// @atom-neo/gateway - Barrel exports
export { startGateway } from "./server";
export { loadGatewayConfig } from "./config";
export type { GatewayConfig, ClientConfig } from "./config";
export { generateSecret, verifySecret, withSecretHeader, SECRET_HEADER } from "./auth/secret";
export { ClientManager } from "./client-manager";
export type { ActiveClient } from "./client-manager";
export { resolveClient, resolveClients, sandboxPackageRoot } from "./client-package/resolver";
export type { ResolvedClientConfig } from "./client-package/resolver";
export { parseManifest, resolveEntry } from "./client-package/manifest";
export type { Manifest } from "./client-package/manifest";
export { installClient, packClient } from "./client-package/archive";
export type { InstallResult, PackOptions } from "./client-package/archive";
export {
  findPackage,
  listPackages,
  readRegistry,
  registerPackage,
  registryPath,
  removePackage,
} from "./client-package/registry";
export type {
  PackageRecord,
  PackageRegistration,
  PackageRegistry,
  RegistryLockOptions,
} from "./client-package/registry";
export { configureInstance } from "./client-package/instance-config";
export type {
  ConfigureInstanceInput,
  ConfigureInstanceResult,
  ConfigureInstanceSource,
} from "./client-package/instance-config";
