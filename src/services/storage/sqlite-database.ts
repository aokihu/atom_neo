import { DatabaseSync } from "node:sqlite";

export type SqliteValue = null | number | bigint | string | boolean | undefined | Uint8Array;

export type SqliteStatementResult = {
  changes: number;
  lastInsertRowid: number | bigint;
};

export type SqliteStatement = {
  get(...params: SqliteValue[]): Record<string, unknown> | undefined;
  all(...params: SqliteValue[]): Record<string, unknown>[];
  run(...params: SqliteValue[]): SqliteStatementResult;
};

type NodeSqliteValue = null | number | bigint | string | NodeJS.ArrayBufferView;

function normalizeParams(params: readonly SqliteValue[]): NodeSqliteValue[] {
  return params.map((value) => {
    if (typeof value === "boolean") return value ? 1 : 0;
    if (value === undefined) return null;
    return value as NodeSqliteValue;
  });
}

function normalizeChanges(result: { changes: number | bigint; lastInsertRowid: number | bigint }): SqliteStatementResult {
  return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
}

/**
 * Thin synchronous wrapper around node:sqlite that keeps the small bun:sqlite surface
 * used by MemoryService: variadic statement parameters and `db.transaction(fn)()`.
 */
export class SqliteDatabase {
  #db: DatabaseSync;
  #transactionDepth = 0;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
  }

  run(sql: string, params: readonly SqliteValue[] = []): SqliteStatementResult {
    return normalizeChanges(this.#db.prepare(sql).run(...normalizeParams(params)));
  }

  prepare(sql: string): SqliteStatement {
    const statement = this.#db.prepare(sql);
    return {
      get: (...params) => {
        const row = statement.get(...normalizeParams(params));
        return row ? { ...row } : undefined;
      },
      all: (...params) => statement.all(...normalizeParams(params)).map((row) => ({ ...row })),
      run: (...params) => normalizeChanges(statement.run(...normalizeParams(params))),
    };
  }

  /** Executes `fn` atomically; nested calls use savepoints. */
  transaction<T>(fn: () => T): () => T {
    return () => {
      const depth = this.#transactionDepth++;
      const savepoint = `atom_transaction_${depth}`;
      try {
        this.#db.exec(depth === 0 ? "BEGIN" : `SAVEPOINT ${savepoint}`);
        const result = fn();
        this.#db.exec(depth === 0 ? "COMMIT" : `RELEASE ${savepoint}`);
        return result;
      } catch (error) {
        try {
          this.#db.exec(depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${savepoint}`);
          if (depth > 0) this.#db.exec(`RELEASE ${savepoint}`);
        } catch { /* the database may already be closed */ }
        throw error;
      } finally {
        this.#transactionDepth = depth;
      }
    };
  }

  exec(sql: string): void {
    this.#db.exec(sql);
  }

  close(): void {
    this.#db.close();
  }
}
