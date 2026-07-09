const SECRET_HEADER = "X-Gateway-Secret";

export function generateSecret(): string {
  return crypto.randomUUID();
}

export function verifySecret(req: Request, secret: string): boolean {
  const provided = req.headers.get(SECRET_HEADER);
  if (!provided || provided.length !== secret.length) return false;
  let result = 0;
  for (let i = 0; i < provided.length; i++) {
    result |= provided.charCodeAt(i) ^ secret.charCodeAt(i);
  }
  return result === 0;
}

export function withSecretHeader(secret: string): HeadersInit {
  return { [SECRET_HEADER]: secret };
}

export { SECRET_HEADER };
