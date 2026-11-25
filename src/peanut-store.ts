/**
 * Today's Store as async methods, so a Durable Object can expose them as RPC.
 *
 * The SQL underneath is synchronous on both drivers. The promises are for the
 * caller outside the object: a Worker awaits stub.createThread(...). Inside,
 * nothing awaits between the requestId check and the commit, so a replay
 * cannot interleave with the write it repeats.
 *
 * Every write takes an optional requestId. The same id returns the first
 * result and does not write again. See requests.ts for why the log is
 * mdview_requests and why mdview_outbox is not created here.
 */
import path from "node:path";
import type { Db } from "./db.ts";
import { nodeSqlite } from "./db-node.ts";
import type { Registry } from "./registry.ts";
import { REQUEST_TTL_MS, REQUESTS_SQL, REQUESTS_TABLE } from "./requests.ts";
import { openStoreOn, Store, STORE_FILE, type Action, type CreateThread, type ReadOptions } from "./store.ts";
import type { Author, DocumentFilter, Status } from "./types.ts";

export class PeanutStore {
  #store: Store;
  #db: Db;

  constructor(store: Store, db: Db) {
    this.#store = store;
    this.#db = db;
  }

  /** Migrates `db`, creates the request log, and returns the async store. */
  static open(db: Db, registry: Registry): PeanutStore {
    const store = openStoreOn(db, registry);
    db.exec(REQUESTS_SQL);
    return new PeanutStore(store, db);
  }

  // async, not Promise.resolve(sync()): a refusal throws inside the call, and only an
  // async function turns that into a rejection the RPC caller can await.

  async close(): Promise<void> {
    this.#store.close();
  }

  async changeToken(): Promise<string> {
    return this.#store.changeToken();
  }

  onWrite(listener: () => void): () => void {
    return this.#store.onWrite(listener);
  }

  async document(type: string, key: string) {
    return this.#store.document(type, key);
  }

  async documents(filter: DocumentFilter = null) {
    return this.#store.documents(filter);
  }

  async observe(type: string, key: string, input?: { content: string; meta?: CreateThread["meta"] }, requestId?: string) {
    return this.#once(requestId, () => this.#store.observe(type, key, input));
  }

  async contentForSha(type: string, key: string, sha: string) {
    return this.#store.contentForSha(type, key, sha);
  }

  async createThread(input: CreateThread & { requestId?: string }): Promise<number> {
    return this.#once(input.requestId, () => this.#store.createThread(input));
  }

  async reply(threadId: number, body: string, author: Author, options: { pending?: boolean; requestId?: string } = {}): Promise<void> {
    const { requestId, ...rest } = options;
    return this.#once(requestId, () => this.#store.reply(threadId, body, author, rest));
  }

  async setStatus(
    threadId: number,
    status: Status,
    author: Author,
    body?: string,
    options: { pending?: boolean; requestId?: string } = {},
  ): Promise<void> {
    const { requestId, ...rest } = options;
    return this.#once(requestId, () => this.#store.setStatus(threadId, status, author, body, rest));
  }

  async apply(actions: Action[], author: Author, options: { requestId?: string } = {}): Promise<void> {
    return this.#once(options.requestId, () => this.#store.apply(actions, author));
  }

  async pendingCount(): Promise<number> {
    return this.#store.pendingCount();
  }

  async sendPending(author: Author, options: { requestId?: string } = {}): Promise<number> {
    return this.#once(options.requestId, () => this.#store.sendPending(author));
  }

  async discardPending(author: Author, options: { requestId?: string } = {}): Promise<number> {
    return this.#once(options.requestId, () => this.#store.discardPending(author));
  }

  async deleteThread(threadId: number, author: Author, options: { requestId?: string } = {}): Promise<void> {
    return this.#once(options.requestId, () => this.#store.deleteThread(threadId, author));
  }

  async deleteMessage(threadId: number, messageId: number, author: Author, options: { requestId?: string } = {}): Promise<void> {
    return this.#once(options.requestId, () => this.#store.deleteMessage(threadId, messageId, author));
  }

  async revisionAt(type: string, key: string, seq: number) {
    return this.#store.revisionAt(type, key, seq);
  }

  async revisions(type: string, key: string) {
    return this.#store.revisions(type, key);
  }

  async waitingOnAgent(options: { filter?: DocumentFilter; after?: number } = {}) {
    return this.#store.waitingOnAgent(options);
  }

  async cursor(): Promise<number> {
    return this.#store.cursor();
  }

  async threadsAt(type: string, key: string, options: ReadOptions & { sha?: string } = {}) {
    return this.#store.threadsAt(type, key, options);
  }

  async threadsIn(filter: DocumentFilter, options: ReadOptions = {}) {
    return this.#store.threadsIn(filter, options);
  }

  async thread(threadId: number, options: ReadOptions = {}) {
    return this.#store.thread(threadId, options);
  }

  async documentOf(threadId: number) {
    return this.#store.documentOf(threadId);
  }

  /** Moves a tracked document to a new key. Threads and revisions keep their ids. */
  async renameDocument(type: string, from: string, to: string, options: { requestId?: string } = {}): Promise<void> {
    return this.#once(options.requestId, () => this.#store.renameDocument(type, from, to));
  }

  async write<T>(fn: (db: Store["db"]) => T, options: { requestId?: string } = {}): Promise<T> {
    return this.#once(options.requestId, () => this.#store.write(fn));
  }

  /** Drops request rows older than seven days before `now`. The nightly cron calls this. */
  async pruneRequests(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - REQUEST_TTL_MS).toISOString();
    return this.#db.run(`DELETE FROM ${REQUESTS_TABLE} WHERE created_at < ?`, cutoff).changes;
  }

  #once<T>(requestId: string | undefined, fn: () => T): T {
    return this.#store.withRequest(requestId, fn);
  }
}

/** The Mac's file, with the request log created. The Durable Object calls PeanutStore.open(doSqlite(ctx.storage), registry) instead. */
export async function openPeanutStore({ registry, dir }: { registry: Registry; dir: string }): Promise<PeanutStore> {
  return PeanutStore.open(await nodeSqlite(path.join(dir, STORE_FILE)), registry);
}
