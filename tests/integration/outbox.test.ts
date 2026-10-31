import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LeadRouter } from "../../src/adapters/router.js";
import { createPool } from "../../src/db/client.js";
import { migrate } from "../../src/db/migrate.js";
import { processOutboxBatch } from "../../src/ingest/outbox.js";
import { intake } from "../../src/ingest/service.js";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("outbox worker", () => {
  const pool = createPool(url ?? "");
  const ok: LeadRouter = { route: async () => {} };
  const failing: LeadRouter = {
    route: async () => {
      throw new Error("crm down");
    },
  };

  beforeAll(async () => {
    await migrate(pool);
  });
  beforeEach(async () => {
    await pool.query(
      "TRUNCATE outbox, rejected_events, leads, raw_events RESTART IDENTITY CASCADE",
    );
    await intake(pool, "web", { source: "web", email: "a@acme.com" });
  });
  afterAll(() => pool.end());

  it("delivers and marks done exactly once", async () => {
    expect(await processOutboxBatch(pool, ok)).toMatchObject({ delivered: 1 });
    expect(await processOutboxBatch(pool, ok)).toMatchObject({ delivered: 0 });
    const { rows } = await pool.query("SELECT status, attempts FROM outbox");
    expect(rows[0]).toMatchObject({ status: "done", attempts: 1 });
  });

  it("keeps the lead and schedules a retry when the destination fails", async () => {
    expect(await processOutboxBatch(pool, failing)).toMatchObject({ retried: 1 });
    const { rows } = await pool.query(
      "SELECT status, attempts, last_error, next_attempt_at > now() AS later FROM outbox",
    );
    expect(rows[0]).toMatchObject({
      status: "pending",
      attempts: 1,
      last_error: "crm down",
      later: true,
    });
    // Not due yet, so an immediate second pass does nothing.
    expect(await processOutboxBatch(pool, ok)).toMatchObject({ delivered: 0 });
  });

  it("moves to dead letter after max attempts", async () => {
    expect(await processOutboxBatch(pool, failing, { maxAttempts: 1 })).toMatchObject({ dead: 1 });
    const { rows } = await pool.query("SELECT status FROM outbox");
    expect(rows[0].status).toBe("dead");
  });
});
