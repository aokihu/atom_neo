let counter = 0;

/** Time-ordered id in the historical `prefix-Date.now()-counter` format. */
export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${counter++}`;
}
