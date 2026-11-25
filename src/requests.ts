/**
 * Idempotency for PeanutStore writes.
 *
 * A Durable Object RPC can be delivered twice. The caller passes a requestId,
 * and a replay returns the first result instead of writing again. The row is
 * written in the same transaction as the change, so a crash rolls both back
 * and the retry does the work.
 *
 * The table is mdview_requests, the name the spec's nightly prune addresses.
 * It is not a core migration: openStore() on the Mac must keep today's
 * schema, and nothing there sends a requestId. PeanutStore creates the table
 * when it opens. mdview_outbox is not here either; that queue is mdview's
 * webhook, and peanut has no notify payload to store.
 */
export const REQUESTS_TABLE = "mdview_requests";

export const REQUESTS_SQL = `CREATE TABLE IF NOT EXISTS ${REQUESTS_TABLE} (
  id         TEXT PRIMARY KEY,
  result     TEXT,
  created_at TEXT
)`;

/** Seven days, matching the spec's prune. */
export const REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * undefined is a real result (reply returns nothing) and JSON has no
 * undefined, so it is marked. null is a different result (observe misses).
 */
export function encodeResult(value: unknown): string {
  return JSON.stringify({ v: value === undefined ? null : value, u: value === undefined });
}

export function decodeResult(result: string | null): unknown {
  if (result == null) return null;
  const parsed = JSON.parse(result) as { v?: unknown; u?: boolean };
  return parsed.u ? undefined : parsed.v;
}
