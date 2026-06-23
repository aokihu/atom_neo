import { describe, test, expect, mock } from "bun:test";
import { SessionStore } from "./store";

describe("SessionStore", () => {
  test("creates session on first get", () => {
    const store = new SessionStore();
    const session = store.get("new-session");
    expect(session.sessionId).toBe("new-session");
    expect(store.size).toBe(1);
  });

  test("returns existing session on repeated get", () => {
    const store = new SessionStore();
    const s1 = store.get("same-session");
    s1.addMessage({ role: "user", content: "test", timestamp: 0 });

    const s2 = store.get("same-session");
    expect(s2.messages.length).toBe(1);
    expect(s1).toBe(s2);
  });

  test("has checks existence", () => {
    const store = new SessionStore();
    expect(store.has("missing")).toBe(false);
    store.get("exists");
    expect(store.has("exists")).toBe(true);
  });

  test("deletes session", () => {
    const store = new SessionStore();
    store.get("tmp");
    expect(store.has("tmp")).toBe(true);

    store.delete("tmp");
    expect(store.has("tmp")).toBe(false);
    expect(store.size).toBe(0);
  });

  test("evicts oldest on overflow", () => {
    const store = new SessionStore(2);
    store.get("first");
    store.get("second");
    store.get("third");

    expect(store.has("first")).toBe(false);
    expect(store.has("second")).toBe(true);
    expect(store.has("third")).toBe(true);
    expect(store.size).toBe(2);
  });

  test("calls closed handler on eviction", () => {
    const handler = mock(() => {});
    const store = new SessionStore(1);
    store.onClosed(handler);

    store.get("first");
    store.get("second");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("first");
  });
});
