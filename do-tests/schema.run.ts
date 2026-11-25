import assert from "node:assert/strict";
import { doSqlite, type Db } from "../src/db.ts";
import { migrate, Registry } from "../src/index.ts";
import { REQUESTS_SQL, REQUESTS_TABLE } from "../src/requests.ts";
import { doTest, storage } from "./harness.ts";

/**
 * The spec's open question: does Durable Object SQLite accept peanut's schema
 * as written (thread_facts, json_valid, the VIRTUAL generated column,
 * RETURNING)? This runs that schema. A failure here is the spike's answer.
 *
 * mdview_outbox is created only in this test. Peanut does not ship it: the
 * webhook payload is still mdview's, and the table is an mdview migration.
 */
const OUTBOX_SQL = `CREATE TABLE mdview_outbox (
  id          INTEGER PRIMARY KEY,
  message_id  INTEGER UNIQUE,
  payload     TEXT CHECK (json_valid(payload)),
  created_at  TEXT,
  attempts    INTEGER DEFAULT 0,
  next_at     TEXT,
  delivered_at TEXT
)`;

function tables(db: Db): string[] {
  return db
    .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' AND name != '_cf_KV' ORDER BY name")
    .map((row) => row.name);
}

doTest("Durable Object SQLite accepts peanut's schema", () => {
  const db = doSqlite(storage());
  const ran = migrate(db, new Registry());
  assert.deepEqual(ran, ["core:1"]);

  let foreignKeys = "pragma accepted";
  try {
    db.exec("PRAGMA foreign_keys = ON");
  } catch (err) {
    foreignKeys = err instanceof Error ? err.message : String(err);
  }
  const fk = db.get<{ foreign_keys: number }>("PRAGMA foreign_keys");
  assert.equal(fk?.foreign_keys, 1, `foreign keys are not enforced (${foreignKeys})`);

  const version = db.get<{ data_version: number }>("PRAGMA data_version");
  assert.equal(typeof version?.data_version, "number");
  // WAL and the busy timeout are how the node driver shares one file. DO
  // SQLite refuses both (SQLITE_AUTH); it already runs one transaction at a
  // time. sqlite_version() is withheld too. Peanut does not call it.
  assert.throws(() => db.exec("PRAGMA journal_mode = WAL"), /SQLITE_AUTH/);
  assert.throws(() => db.exec("PRAGMA busy_timeout = 5000"), /SQLITE_AUTH/);
  assert.throws(() => db.exec("SELECT sqlite_version()"), /not authorized/);

  const now = "2026-11-01T00:00:00.000Z";
  db.exec(`INSERT INTO documents (id, type, key, created_at) VALUES (1, 'notes.page', '/a.md', '${now}');
    INSERT INTO revisions (id, document_id, seq, sha256, content, observed_at) VALUES (1, 1, 1, 'x', '# A', '${now}');
    INSERT INTO threads (id, document_id, revision_id, anchor_type, anchor, created_at) VALUES (1, 1, 1, 'markdown.block', '{}', '${now}');`);

  const inserted = db.get<{ id: number; pending: number }>(
    "INSERT INTO messages (thread_id, revision_id, author, author_kind, body, created_at, sent_at) VALUES (1, 1, 'x', 'human', 'hi', ?, NULL) RETURNING id, pending",
    now,
  );
  assert.equal(inserted?.id, 1);
  assert.equal(inserted?.pending, 1, "VIRTUAL generated column");
  assert.deepEqual(db.get("SELECT draft, waiting_on FROM thread_facts"), { draft: 1, waiting_on: null });

  db.run("UPDATE messages SET sent_at = ? WHERE id = 1", now);
  assert.equal(db.get<{ pending: number }>("SELECT pending FROM messages WHERE id = 1")?.pending, 0);
  assert.deepEqual(db.get("SELECT draft, waiting_on FROM thread_facts"), { draft: 0, waiting_on: "agent" });

  assert.throws(
    () => db.exec("INSERT INTO revisions (document_id, seq, sha256, content, meta, observed_at) VALUES (1, 2, 'y', '', 'nope', 'now')"),
    /CHECK/,
  );
  assert.throws(
    () => db.exec("INSERT INTO threads (document_id, revision_id, anchor_type, anchor, created_at) VALUES (1, 1, 'markdown.block', 'nope', 'now')"),
    /CHECK/,
  );

  // Indexed insert must count as one row, not one row plus its index entry.
  db.exec("CREATE TABLE spike_indexed (id INTEGER PRIMARY KEY, name TEXT)");
  db.exec("CREATE INDEX spike_indexed_name ON spike_indexed (name)");
  assert.equal(db.run("INSERT INTO spike_indexed (name) VALUES ('a')").changes, 1);
  assert.equal(db.run("DELETE FROM spike_indexed WHERE name = 'a'").changes, 1);

  assert.throws(() => {
    db.transaction(() => {
      db.run("INSERT INTO documents (type, key, created_at) VALUES ('notes.page', 'rolled-back', ?)", now);
      throw new Error("no");
    });
  }, /no/);
  assert.equal(db.get<{ n: number }>("SELECT count(*) AS n FROM documents WHERE key = 'rolled-back'")?.n, 0);

  assert.throws(
    () => db.run("INSERT INTO revisions (document_id, seq, sha256, content, observed_at) VALUES (999, 1, 'z', '', ?)", now),
    /FOREIGN KEY/,
  );

  db.exec(OUTBOX_SQL);
  db.run("INSERT INTO mdview_outbox (message_id, payload, created_at) VALUES (1, ?, ?)", '{"ok":true}', now);
  assert.throws(() => db.run("INSERT INTO mdview_outbox (message_id, payload, created_at) VALUES (2, 'nope', ?)", now), /CHECK/);

  db.exec(REQUESTS_SQL);
  assert.ok(tables(db).includes("thread_facts"));
  assert.ok(tables(db).includes("mdview_outbox"));
  assert.ok(tables(db).includes(REQUESTS_TABLE));
});
