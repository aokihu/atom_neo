import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteDatabase } from "./sqlite-database";

let dir: string | undefined;
let db: SqliteDatabase | undefined;

function open(): SqliteDatabase {
  dir = mkdtempSync(join(tmpdir(), "atom-sqlite-"));
  db = new SqliteDatabase(join(dir, "test.db"));
  db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL)");
  return db;
}

afterEach(() => {
  try { db?.close(); } catch { /* already closed by the test */ }
  db = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("SqliteDatabase", () => {
  test("runs statements and reads rows", () => {
    const database = open();
    const inserted = database.run("INSERT INTO items (name, active) VALUES (?, ?)", ["alpha", true]);

    expect(inserted.changes).toBe(1);
    expect(Number(inserted.lastInsertRowid)).toBe(1);
    expect(database.prepare("SELECT name, active FROM items WHERE id = ?").get(1)).toEqual({ name: "alpha", active: 1 });
    expect(database.prepare("SELECT name FROM items ORDER BY id").all()).toEqual([{ name: "alpha" }]);
  });

  test("commits and rolls back transactions", () => {
    const database = open();
    const insert = database.transaction(() => {
      database.run("INSERT INTO items (name, active) VALUES (?, ?)", ["kept", false]);
    });
    insert();
    expect(database.prepare("SELECT COUNT(*) AS count FROM items").get()?.count).toBe(1);

    const failing = database.transaction(() => {
      database.run("INSERT INTO items (name, active) VALUES (?, ?)", ["discarded", true]);
      throw new Error("rollback");
    });
    expect(failing).toThrow("rollback");
    expect(database.prepare("SELECT COUNT(*) AS count FROM items").get()?.count).toBe(1);
  });

  test("supports nested transactions through savepoints", () => {
    const database = open();
    database.transaction(() => {
      database.run("INSERT INTO items (name, active) VALUES (?, ?)", ["outer", true]);
      try {
        database.transaction(() => {
          database.run("INSERT INTO items (name, active) VALUES (?, ?)", ["inner", true]);
          throw new Error("inner rollback");
        })();
      } catch { /* outer transaction continues */ }
    })();

    expect(database.prepare("SELECT name FROM items ORDER BY id").all()).toEqual([{ name: "outer" }]);
  });

  test("rejects use after close", () => {
    const database = open();
    database.close();
    expect(() => database.prepare("SELECT 1").get()).toThrow();
  });

  test("supports FTS5 virtual tables", () => {
    const database = open();
    database.exec("CREATE VIRTUAL TABLE docs USING fts5(content)");
    database.run("INSERT INTO docs (content) VALUES (?)", ["hello atom neo"]);

    expect(database.prepare("SELECT content FROM docs WHERE docs MATCH ?").all("atom")).toEqual([
      { content: "hello atom neo" },
    ]);
  });
});
