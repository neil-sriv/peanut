import { DurableObject } from "cloudflare:workers";

/**
 * Test-only object. The store suites call doSqlite on its storage; this
 * class is not the Worker that will serve specs, and nothing here is deployed.
 */
export class PeanutStoreDO extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
  }
}

export default {
  fetch() {
    return new Response(null, { status: 404 });
  },
};
