const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/**
 * Official source traffic may use HTTPS anywhere, or plain HTTP only on loopback
 * for local tests/fixtures. Arbitrary public HTTP is rejected.
 */
export function isAllowedSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname));
  } catch {
    return false;
  }
}

export function sourceUrlError(value: string): Error {
  return new Error(`Source URL must use HTTPS or loopback HTTP: ${value}`);
}
