import assert from "node:assert/strict";
import path from "node:path";
import MarkdownIt from "markdown-it";
import { markdownBlock, PeanutStore, Registry, StoreError } from "../src/index.ts";
import type { App, Author } from "../src/types.ts";

const md = new MarkdownIt();
const HUMAN: Author = { name: "adam", kind: "human" };
const AGENT: Author = { name: "agent", kind: "agent", session: "940d8cee" };
const PLAN = "# Plan\n\n## Why\n\nThe two stores drifted apart.\n\n## How\n\nOne library.\n";

export interface PeanutHarness {
  test: (name: string, fn: () => Promise<void> | void) => void;
  open: () => Promise<PeanutStore>;
}

function app(pages: Map<string, string>): App {
  return {
    name: "notes",
    anchorTypes: [markdownBlock({ tokenize: (content) => ({ tokens: md.parse(content, {}) }) })],
    documentTypes: [
      {
        name: "notes.page",
        noun: "page",
        anchorTypes: ["markdown.block"],
        readContent: (key) => (pages.has(key) ? { content: pages.get(key)! } : null),
        displayName: (key) => path.basename(key),
      },
    ],
  };
}

/** A fresh registry each open, sharing `pages` so a test can edit the document. */
export function registryFor(pages: Map<string, string>): Registry {
  return new Registry().register(app(pages));
}

export function registerPeanutTests(h: PeanutHarness): void {
  h.test("a replayed requestId returns the first result and does not write again", async () => {
    const pages = new Map<string, string>([["a/plan.md", PLAN]]);
    const store = await h.open();
    const input = {
      type: "notes.page",
      key: "a/plan.md",
      content: PLAN,
      anchorType: "markdown.block",
      spec: { quote: "drifted apart" },
      body: "Why?",
      author: HUMAN,
      requestId: "create-1",
    };
    const id = await store.createThread(input);
    pages.set("a/plan.md", "# Gone\n");
    const again = await store.createThread({ ...input, body: "A different message." });
    assert.equal(again, id);
    const thread = await store.thread(id);
    assert.equal(thread.thread.messages.length, 1);
    assert.equal(thread.thread.messages[0]?.body, "Why?");
    const docs = await store.documents();
    assert.equal(docs.length, 1);
    assert.equal(docs[0]?.threads, 1);
  });

  h.test("a requestId that failed is not remembered, and a later success is", async () => {
    const store = await h.open();
    const input = {
      type: "notes.page",
      key: "a/plan.md",
      content: PLAN,
      anchorType: "markdown.block",
      spec: { quote: "drifted apart" },
      body: "   ",
      author: HUMAN,
      requestId: "create-blank",
    };
    await assert.rejects(() => store.createThread(input), (err) => err instanceof StoreError);
    const id = await store.createThread({ ...input, body: "Why?" });
    assert.equal(await store.createThread({ ...input, body: "Other." }), id);
  });

  h.test("replaying sendPending does not stamp the messages a second time", async () => {
    const store = await h.open();
    const id = await store.createThread({
      type: "notes.page",
      key: "a/plan.md",
      content: PLAN,
      anchorType: "markdown.block",
      spec: { quote: "drifted apart" },
      body: "Why?",
      author: HUMAN,
      pending: true,
      requestId: "create-pending",
    });
    assert.equal(await store.sendPending(HUMAN, { requestId: "send-1" }), 1);
    const sentAt = (await store.thread(id, { includePending: true })).thread.messages[0]?.sentAt;
    assert.ok(sentAt);
    assert.equal(await store.sendPending(HUMAN, { requestId: "send-1" }), 1);
    assert.equal((await store.thread(id, { includePending: true })).thread.messages[0]?.sentAt, sentAt);
    assert.equal(await store.pendingCount(), 0);
  });

  h.test("a pruned requestId can write again", async () => {
    const store = await h.open();
    const input = {
      type: "notes.page",
      key: "a/plan.md",
      content: PLAN,
      anchorType: "markdown.block",
      spec: { quote: "drifted apart" },
      body: "Why?",
      author: HUMAN,
      requestId: "create-prune",
    };
    const first = await store.createThread(input);
    const pruned = await store.pruneRequests(new Date(Date.now() + 8 * 24 * 60 * 60 * 1000));
    assert.equal(pruned, 1);
    const second = await store.createThread({ ...input, body: "Again.", spec: { quote: "drifted apart" } });
    assert.notEqual(second, first);
    assert.equal((await store.documents())[0]?.threads, 2);
  });

  h.test("apply is still all or none, and a replay does not apply twice", async () => {
    const store = await h.open();
    const thread = {
      type: "notes.page",
      key: "a/plan.md",
      content: PLAN,
      anchorType: "markdown.block",
      author: HUMAN,
    };
    const a = await store.createThread({ ...thread, spec: { quote: "drifted apart" }, body: "Why?" });
    const b = await store.createThread({ ...thread, spec: { quote: "One library" }, body: "And?" });
    await assert.rejects(
      () => store.apply([{ reply: a, message: "ok" }, { reply: 999, message: "no" }], AGENT, { requestId: "apply-bad" }),
      /No thread #999/,
    );
    assert.equal((await store.thread(a)).thread.messages.length, 1);
    await store.apply([{ reply: a, message: "Because." }, { suggestResolve: b, message: "Done." }], AGENT, { requestId: "apply-ok" });
    await store.apply([{ reply: a, message: "A second time." }], AGENT, { requestId: "apply-ok" });
    const view = await store.thread(a);
    assert.equal(view.thread.messages.length, 2);
    assert.equal(view.thread.messages[1]?.body, "Because.");
    assert.equal((await store.thread(b)).thread.status, "suggested");
  });

  h.test("an empty requestId is refused", async () => {
    const store = await h.open();
    await assert.rejects(
      () =>
        store.reply(1, "Hi.", HUMAN, { requestId: "  " }),
      (err) => err instanceof StoreError && /requestId/.test(err.message),
    );
  });
}
