/** Decode one required URL path segment after the expected route prefix. */
export function decodePathParam(pathname: string, prefix: string): string | undefined {
  if (!pathname.startsWith(prefix)) return undefined;
  const encoded = pathname.slice(prefix.length);
  if (!encoded || encoded.includes("/")) return undefined;

  try {
    return decodeURIComponent(encoded) || undefined;
  } catch {
    return undefined;
  }
}
