import { listInstances, upsertInstance } from "@atom-neo/shared";
import type { ClientConfig } from "@atom-neo/shared";

export type UpgradeApply = () => Promise<"reloaded" | "registered">;

export type UpgradeResult = {
  id: string;
  packageId: string;
  oldVersion: string;
  newVersion: string;
  changed: boolean;
  applied: "reloaded" | "registered" | null;
  rolledBack: boolean;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Point one package-based client instance at `newVersion` and optionally apply it.
 *
 * Package versions coexist, so the previous version stays installed. Only the named
 * instance is switched; when `apply` fails the previous instance config is restored.
 */
export async function upgradeClientInstance(
  sandbox: string,
  instanceId: string,
  newVersion: string,
  options: { apply?: UpgradeApply } = {},
): Promise<UpgradeResult> {
  const current = listInstances(sandbox).find((instance) => instance.id === instanceId);
  if (current === undefined) throw new Error(`Unknown client instance: ${instanceId}`);
  if (current.directory !== undefined) {
    throw new Error(
      `Client instance "${instanceId}" uses a directory source; only package instances can be upgraded`,
    );
  }
  if (current.package === undefined) {
    throw new Error(`Client instance "${instanceId}" has no package source`);
  }

  const { id: packageId, version: oldVersion } = current.package;
  const next: ClientConfig = { ...current, package: { id: packageId, version: newVersion } };
  upsertInstance(sandbox, next);

  let applied: UpgradeResult["applied"] = null;
  if (options.apply !== undefined) {
    try {
      applied = await options.apply();
    } catch (error) {
      const cause = errorMessage(error);
      try {
        upsertInstance(sandbox, current);
      } catch (rollbackError) {
        throw new Error(
          `Upgrade of client "${instanceId}" to ${packageId}@${newVersion} failed: ${cause}; restoring ${packageId}@${oldVersion} also failed: ${errorMessage(rollbackError)}`,
          { cause: error },
        );
      }
      throw new Error(
        `Upgrade of client "${instanceId}" to ${packageId}@${newVersion} failed: ${cause}; old version ${packageId}@${oldVersion} restored`,
        { cause: error },
      );
    }
  }

  return {
    id: instanceId,
    packageId,
    oldVersion,
    newVersion,
    changed: oldVersion !== newVersion,
    applied,
    rolledBack: false,
  };
}
