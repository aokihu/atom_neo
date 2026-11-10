import { describe, expect, test } from "bun:test";
import { BaseService } from "./base-service";
import { ServiceManager } from "./service-manager";

class TestService extends BaseService {
  readonly name: string;
  readonly events: string[];
  #failStart: boolean;

  constructor(name: string, events: string[], failStart = false) {
    super();
    this.name = name;
    this.events = events;
    this.#failStart = failStart;
  }

  protected override async onStart(): Promise<void> {
    if (this.#failStart) throw new Error(`${this.name} start failed`);
    this.events.push(`start:${this.name}`);
  }

  protected override async onStop(): Promise<void> {
    this.events.push(`stop:${this.name}`);
  }
}

describe("BaseService lifecycle", () => {
  test("stays stopped and cleans up when subclass initialization fails", async () => {
    const events: string[] = [];
    const service = new TestService("broken", events, true);

    await expect(service.start()).rejects.toThrow("broken start failed");
    expect(service.isRunning).toBe(false);
    expect(events).toEqual(["stop:broken"]);
  });

  test("is idempotent and sets running only after initialization", async () => {
    const events: string[] = [];
    const service = new TestService("ok", events);

    await service.start();
    await service.start();
    expect(service.isRunning).toBe(true);
    expect(events).toEqual(["start:ok"]);

    await service.stop();
    await service.stop();
    expect(service.isRunning).toBe(false);
    expect(events).toEqual(["start:ok", "stop:ok"]);
  });
});

describe("ServiceManager.startAll", () => {
  test("fails fast and rolls back already-started services", async () => {
    const events: string[] = [];
    const manager = new ServiceManager();
    manager.register("first", new TestService("first", events));
    manager.register("broken", new TestService("broken", events, true));
    manager.register("never", new TestService("never", events));

    await expect(manager.startAll()).rejects.toThrow("broken start failed");

    expect(events).toEqual(["start:first", "stop:broken", "stop:first"]);
    expect(manager.get<TestService>("first")?.isRunning).toBe(false);
    expect(manager.get<TestService>("broken")?.isRunning).toBe(false);
    expect(manager.get<TestService>("never")?.isRunning).toBe(false);
  });
});
