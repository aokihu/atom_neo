export function normalizeError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === "string") return new Error(err);
  return new Error(String(err));
}

export function errorMessage(err: unknown): string {
  return normalizeError(err).message;
}
