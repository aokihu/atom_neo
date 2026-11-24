import { expect, test } from "bun:test";
import { startWizard } from "./app";

test("startWizard rejects config mode instead of rendering an empty shell", async () => {
  await expect(startWizard("/tmp/atom", "config" as any)).rejects.toThrow("startWizard only supports first-run");
});
