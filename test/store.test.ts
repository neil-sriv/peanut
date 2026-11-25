import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openStore, STORE_FILE, type Registry } from "../src/index.ts";
import { registerStoreTests } from "./store.suite.ts";

registerStoreTests({
  test,
  sqliteFileExists: (dir) => fs.existsSync(path.join(dir, STORE_FILE)),
  open: async (registry) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "peanut-store-"));
    const store = await openStore({ registry, dir });
    return { store, dir, again: (next: Registry) => openStore({ registry: next, dir }) };
  },
});
