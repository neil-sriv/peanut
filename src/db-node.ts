/**
 * node:sqlite as a Db. WAL mode and a busy timeout are set here, and only
 * here: a Durable Object's SQLite rejects both pragmas (it already serializes
 * writes), so doSqlite never sends them.
 */
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { brandDb, type Db, type SqlValue } from "./db.ts";

const BUSY_TIMEOUT_MS = 5000;

export interface NodeDb extends Db {
  readonly kind: "node";
  readonly sqlite: DatabaseSync;
}

export function wrapNode(sqlite: DatabaseSync): NodeDb {
  const db: NodeDb = {
    kind: "node",
    sqlite,
    exec(sql) {
      sqlite.exec(sql);
    },
    get(sql, ...params) {
      return sqlite.prepare(sql).get(...asInput(params)) as never;
    },
    all(sql, ...params) {
      return sqlite.prepare(sql).all(...asInput(params)) as never;
    },
    run(sql, ...params) {
      return { changes: Number(sqlite.prepare(sql).run(...asInput(params)).changes) };
    },
    transaction(fn) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const result = fn();
        sqlite.exec("COMMIT");
        return result;
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      }
    },
    close() {
      sqlite.close();
    },
  };
  return brandDb(db);
}

/** Opens (and creates) the store file, then sets the pragmas two processes need to share it. */
export async function nodeSqlite(file: string): Promise<NodeDb> {
  const specifier = "node:sqlite";
  const { DatabaseSync } = await import(specifier);
  const sqlite = new DatabaseSync(file);
  sqlite.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  sqlite.exec("PRAGMA journal_mode = WAL");
  return wrapNode(sqlite);
}

function asInput(params: SqlValue[]): SQLInputValue[] {
  return params as SQLInputValue[];
}
