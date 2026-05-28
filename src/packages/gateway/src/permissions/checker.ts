import { PermissionLevel } from "@atom-neo/shared";

export { PermissionLevel };

export function checkPermission(required: number, granted: number): boolean {
  return granted >= required;
}
