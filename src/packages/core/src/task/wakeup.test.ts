import { describe, expect, test } from "bun:test";
import { Wakeup } from "./wakeup";

const timeout = (ms: number) => new Promise<"timeout">(resolve => setTimeout(() => resolve("timeout"), ms));

describe("Wakeup", () => {
  test("resolves a waiter notified later", async () => {
    const wake = new Wakeup();
    let settled = false;
    const waiting = wake.wait().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    wake.notify();
    await waiting;
    expect(settled).toBe(true);
  });

  test("does not lose a notify that arrives before wait", async () => {
    const wake = new Wakeup();
    wake.notify();
    await wake.wait();
  });

  test("repeated notify before wait satisfies only one wait", async () => {
    const wake = new Wakeup();
    wake.notify();
    wake.notify();
    await wake.wait();

    const waiting = wake.wait().then(() => "woken" as const);
    expect(await Promise.race([waiting, timeout(10)])).toBe("timeout");
    wake.notify();
    expect(await waiting).toBe("woken");
  });

  test("repeated notify while waiting resolves the waiter once", async () => {
    const wake = new Wakeup();
    let wakes = 0;
    const waiting = wake.wait().then(() => { wakes++; });

    wake.notify();
    wake.notify();
    await waiting;
    expect(wakes).toBe(1);
  });
});
