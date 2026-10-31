import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../../src/db/client.js";
import { eraseByEmail, purgeExpiredLeads } from "../../src/db/erasure.js";
import { migrate } from "../../src/db/migrate.js";
import { renderMetrics } from "../../src/ingest/metrics.js";
import { intake } from "../../src/ingest/service.js";

const url = process.env.TEST_DATABASE_URL;
const count = async (pool: ReturnType<typeof createPool>, t: string) =>
  (await pool.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n as number;

describe.skipIf(!url)("erasure, retention and metrics", () => {
  const pool = createPool(url ?? "");
  beforeAll(() => migrate(pool));
  beforeEach(async () => {
    await pool.query(
      "TRUNCATE outbox, rejected_events, leads, raw_events RESTART IDENTITY CASCADE",
    );
    await intake(pool, "web", { source: "web", email: "Jane@Acme.com" });
    await intake(pool, "web", { source: "web", email: "other@acme.com" });
    await intake(pool, "web", { source: "web", email: "jane@acme.com", phone: "bad" }); // duplicate raw
  });
  afterAll(() => pool.end());

  it("erases every trace of one email and leaves others", async () => {
    const counts = await eraseByEmail(pool, " JANE@acme.com ");
    expect(counts).toMatchObject({ leads: 1, rawEvents: 2, outbox: 1 });
    expect(await count(pool, "leads")).toBe(1);
    expect(await count(pool, "raw_events")).toBe(1);
    expect(await count(pool, "outbox")).toBe(1);
  });

  it("purges only leads past the retention window", async () => {
    await pool.query(
      "UPDATE leads SET created_at = now() - interval '25 months' WHERE email='other@acme.com'",
    );
    expect(await purgeExpiredLeads(pool, 24)).toMatchObject({ leads: 1, outbox: 1 });
    expect(await count(pool, "leads")).toBe(1);
  });

  it("renders alertable metrics", async () => {
    const text = await renderMetrics(pool);
    expect(text).toContain("lead_outbox_pending 2");
    expect(text).toContain("lead_outbox_dead 0");
    expect(text).toContain("lead_total 2");
  });
});
