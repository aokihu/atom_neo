// Verify the remote-management secret stays in the parent process.
import { expect, test } from "bun:test";
import { createChildProcessEnv } from "./child-process-env";

test("strips the admin token while preserving other child environment values", () => {
  const source = { PATH: "/bin", ATOM_ADMIN_TOKEN: "private", PLATFORM_KEY: "platform" };
  expect(createChildProcessEnv(source)).toEqual({ PATH: "/bin", PLATFORM_KEY: "platform" });
  expect(source.ATOM_ADMIN_TOKEN).toBe("private");
});
