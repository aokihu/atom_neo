import { createHmac, timingSafeEqual } from "node:crypto";

export type JwtPayload = {
  sub: string;
  permissionLevel: number;
  iat: number;
  exp: number;
};

export class JwtVerifier {
  #secret: string;

  constructor(secret: string) {
    this.#secret = secret;
  }

  async verify(token: string): Promise<JwtPayload | null> {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;

      const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as JwtPayload;
      const signature = parts[2];

      if (header.alg !== "HS256") return null;
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

      const expected = this.#sign(`${parts[0]}.${parts[1]}`);
      const sigBuf = Buffer.from(signature, "base64url");
      const expBuf = Buffer.from(expected, "base64url");
      if (sigBuf.length !== expBuf.length) return null;

      return timingSafeEqual(sigBuf, expBuf) ? payload : null;
    } catch {
      return null;
    }
  }

  async sign(payload: Omit<JwtPayload, "iat" | "exp">): Promise<string> {
    const header = { alg: "HS256", typ: "JWT" };
    const body = {
      ...payload,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
    const bodyB64 = Buffer.from(JSON.stringify(body)).toString("base64url");
    const sigB64 = this.#sign(`${headerB64}.${bodyB64}`);
    return `${headerB64}.${bodyB64}.${sigB64}`;
  }

  #sign(data: string): string {
    return createHmac("sha256", this.#secret).update(data).digest("base64url");
  }
}
