import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { it } from "vitest";
import type { DoSqliteStorage } from "../src/db.ts";

let seq = 0;
let current: DoSqliteStorage | undefined;

/** Runs `fn` inside a fresh Durable Object, where `storage()` is that object's SQLite. */
export function doTest(name: string, fn: () => Promise<void> | void): void {
  it(name, async () => {
    const ns = (env as unknown as { STORE: { idFromName(name: string): never; get(id: never): never } }).STORE;
    await runInDurableObject(ns.get(ns.idFromName(`t${++seq}`)), async (_instance: unknown, state: { storage: DoSqliteStorage }) => {
      current = state.storage;
      try {
        await fn();
      } finally {
        current = undefined;
      }
    });
  });
}

export function storage(): DoSqliteStorage {
  if (!current) throw new Error("Durable Object storage is only available inside a test.");
  return current;
}
