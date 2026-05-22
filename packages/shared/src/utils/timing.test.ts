import { describe, test, expect, mock } from "bun:test";
import { sleep, debounce } from "./timing";

describe("sleep", () => {
  test("resolves after the given time", async () => {
    const start = performance.now();
    await sleep(10);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(5);
  });
});

describe("debounce", () => {
  test("delays function call until after delay", async () => {
    const fn = mock(() => {});
    const debounced = debounce(fn, 50);
    debounced();
    expect(fn).toHaveBeenCalledTimes(0);
    await sleep(80);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("only calls function once for rapid invocations", async () => {
    const fn = mock(() => {});
    const debounced = debounce(fn, 50);
    debounced();
    debounced();
    debounced();
    await sleep(80);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
