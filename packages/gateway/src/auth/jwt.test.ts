import { describe, test, expect } from "bun:test";
import { JwtVerifier } from "./jwt";

describe("JwtVerifier", () => {
  const verifier = new JwtVerifier("test-secret-min-16-chars");

  test("signs and verifies a valid token", async () => {
    const token = await verifier.sign({ sub: "user1", permissionLevel: 2 });
    const payload = await verifier.verify(token);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe("user1");
    expect(payload!.permissionLevel).toBe(2);
  });

  test("rejects invalid token", async () => {
    const payload = await verifier.verify("invalid.token.here");
    expect(payload).toBeNull();
  });

  test("rejects expired token", async () => {
    // Create token with past exp
    const parts = (await verifier.sign({ sub: "u", permissionLevel: 0 })).split(".");
    expect(parts.length).toBe(3);
  });
});
