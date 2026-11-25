import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openPeanutStore, openStore, STORE_FILE } from "../src/index.ts";
import { REQUESTS_TABLE } from "../src/requests.ts";
import { registerPeanutTests, registryFor } from "./peanut-store.suite.ts";

registerPeanutTests({
  test,
  open: async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "peanut-async-"));
    const pages = new Map<string, string>();
    return openPeanutStore({ registry: registryFor(pages), dir });
  },
});

test("the request log is mdview_requests and is absent from a plain store", async () => {
  const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), "peanut-plain-"));
  const asyncDir = fs.mkdtempSync(path.join(os.tmpdir(), "peanut-async-"));
  const pages = new Map<string, string>();
  const plain = await openStore({ registry: registryFor(pages), dir: plainDir });
  plain.close();
  const asyncStore = await openPeanutStore({ registry: registryFor(pages), dir: asyncDir });
  await asyncStore.close();

  const { DatabaseSync } = await import("node:sqlite");
  const names = (file: string) => {
    const db = new DatabaseSync(file);
    try {
      return db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .all(REQUESTS_TABLE)
        .map((row) => String(row.name));
    } finally {
      db.close();
    }
  };
  assert.deepEqual(names(path.join(plainDir, STORE_FILE)), []);
  assert.deepEqual(names(path.join(asyncDir, STORE_FILE)), [REQUESTS_TABLE]);
});
