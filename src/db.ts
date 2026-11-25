/**
 * The SQL peanut runs, apart from which SQLite is underneath it.
 *
 * nodeSqlite (db-node.ts) is the Mac: a file, WAL mode, a busy timeout.
 * doSqlite is a Durable Object's built-in SQLite, ctx.storage.sql. That
 * engine rejects journal and busy-timeout pragmas, and it has no BEGIN:
 * transactionSync is the transaction. Both speak this interface, and the
 * store does not care which one it has.
 *
 * run() reports SQLite's own change count (changes / total_changes), the
 * rows a statement inserted, updated or deleted. Durable Object cursors
 * also expose rowsWritten, which counts index maintenance, so a single
 * insert into an indexed table would report 2 and sendPending() would lie.
 */
export type SqlValue = string | number | bigint | null | Uint8Array;

const BRAND = Symbol.for("peanut.db");

export interface Db {
  readonly kind: "node" | "do";
  exec(sql: string): void;
  get<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): T | undefined;
  all<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): T[];
  /** How many rows the statement changed, not how many index entries it touched. */
  run(sql: string, ...params: SqlValue[]): { changes: number };
  transaction<T>(fn: () => T): T;
  close(): void;
}

/** What doSqlite reads off a Durable Object. ctx.storage satisfies it. */
export interface DoSqliteStorage {
  sql: {
    exec(query: string, ...bindings: readonly unknown[]): { toArray(): readonly unknown[] };
  };
  transactionSync<T>(closure: () => T): T;
}

export function isDb(value: object): value is Db {
  return BRAND in value;
}

export function brandDb<T extends Db>(db: T): T {
  (db as T & { [BRAND]?: true })[BRAND] = true;
  return db;
}

interface SharedWrites {
  sharedWrites(): number;
  setSharedWrites(n: number): void;
}

/**
 * A write counter shared by every doSqlite() handle on one Durable Object.
 *
 * Node sees another process's commit through PRAGMA data_version. A Durable
 * Object has one connection, so two Store objects on it do not: data_version
 * stays put and each object's memory does not know about the other. The
 * counter is keyed by the storage object both handles are given. A WeakMap
 * rather than a property, because storage is a host object.
 */
const sharedWrites = new WeakMap<object, { n: number }>();

function sharedBox(storage: object): { n: number } {
  let box = sharedWrites.get(storage);
  if (!box) sharedWrites.set(storage, (box = { n: 0 }));
  return box;
}

export function doSqlite(storage: DoSqliteStorage): Db {
  const box = sharedBox(storage);
  const db: Db & SharedWrites = {
    kind: "do",
    exec(sql) {
      storage.sql.exec(sql).toArray();
    },
    get(sql, ...params) {
      return storage.sql.exec(sql, ...params).toArray()[0] as never;
    },
    all(sql, ...params) {
      return storage.sql.exec(sql, ...params).toArray() as never;
    },
    run(sql, ...params) {
      const before = totalChanges(storage);
      storage.sql.exec(sql, ...params).toArray();
      return { changes: totalChanges(storage) - before };
    },
    transaction(fn) {
      return storage.transactionSync(fn);
    },
    close() {},
    sharedWrites() {
      return box.n;
    },
    setSharedWrites(n: number) {
      box.n = n;
    },
  };
  return brandDb(db);
}

function totalChanges(storage: DoSqliteStorage): number {
  const row = storage.sql.exec("SELECT total_changes() AS n").toArray()[0] as { n?: number | bigint } | undefined;
  return Number(row?.n ?? 0);
}
