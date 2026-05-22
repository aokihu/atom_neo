export enum PermissionLevel {
  READ_ONLY = 0,
  FILE_WRITE = 1,
  FULL = 2,
}

export function checkPermission(required: number, granted: number): boolean {
  return granted >= required;
}
