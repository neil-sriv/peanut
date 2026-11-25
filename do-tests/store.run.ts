import { doSqlite } from "../src/db.ts";
import { PeanutStore, openStoreOn } from "../src/index.ts";
import { registerPeanutTests, registryFor } from "../test/peanut-store.suite.ts";
import { registerStoreTests } from "../test/store.suite.ts";
import { doTest, storage } from "./harness.ts";

registerStoreTests({
  test: doTest,
  open: async (registry) => {
    const store = openStoreOn(doSqlite(storage()), registry);
    return {
      store,
      again: (next) => Promise.resolve(openStoreOn(doSqlite(storage()), next)),
    };
  },
});

registerPeanutTests({
  test: doTest,
  open: async () => {
    const pages = new Map<string, string>();
    return PeanutStore.open(doSqlite(storage()), registryFor(pages));
  },
});
