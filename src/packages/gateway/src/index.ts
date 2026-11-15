// @atom-neo/gateway - Barrel exports
export { startGateway } from "./server";
export { loadGatewayConfig } from "./config";
export type { GatewayConfig, ClientConfig } from "./config";
export { generateSecret, verifySecret, withSecretHeader, SECRET_HEADER } from "./auth/secret";
export { ClientManager } from "./client-manager";
export type { ActiveClient, ClientStatus } from "./client-manager";
export { DiagnosticsStore, readClientDiagnostics } from "./client-manager/diagnostics";
export type {
  ClientDiagnostics,
  DiagnosticEvent,
  DiagnosticStage,
} from "./client-manager/diagnostics";
export { resolveClient, resolveClients, sandboxPackageRoot } from "./client-package/resolver";
export type { ResolvedClientConfig } from "./client-package/resolver";
export { parseManifest, resolveEntry } from "./client-package/manifest";
export type { Manifest } from "./client-package/manifest";
export { installClient, packClient } from "./client-package/archive";
export type { InstallOptions, InstallResult, PackOptions } from "./client-package/archive";
export { loadSourceIndex, selectSourceEntry, parseSourceIndex, createSourceIndexEntry, sourceIndexDocument, compareSourceVersions } from "./client-package/source-index";
export type { SourceIndex, SourceIndexEntry } from "./client-package/source-index";
export { downloadVerifiedArtifact } from "./client-package/download";
export type { DownloadArtifact, DownloadOptions, DownloadedArtifact } from "./client-package/download";
export { installSourcePackage } from "./client-package/source-install";
export type { SourceInstallOptions, SourceInstallResult } from "./client-package/source-install";
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
  RemovePackageOptions,
  RemovePackageResult,
} from "./client-package/registry";
export { configureInstance } from "./client-package/instance-config";
export type {
  ConfigureInstanceInput,
  ConfigureInstanceResult,
  ConfigureInstanceSource,
} from "./client-package/instance-config";
