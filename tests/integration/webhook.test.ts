import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../../src/db/client.js";
import { migrate } from "../../src/db/migrate.js";
import { buildServer } from "../../src/ingest/server.js";
import { signatureHeader } from "../../src/ingest/signature.js";

const url = process.env.TEST_DATABASE_URL;
const SECRET = "test-secret-0123456789";

describe.skipIf(!url)("POST /webhooks/leads", () => {
  const pool = createPool(url ?? "");
  const app = buildServer({
    pool,
    webhookSecret: SECRET,
    metricsToken: "m".repeat(20),
    logLevel: "silent",
  });

  const post = (body: unknown, signature?: string) => {
    const payload = JSON.stringify(body);
    return app.inject({
      method: "POST",
      url: "/webhooks/leads",
      headers: {
        "content-type": "application/json",
        "x-signature": signature ?? signatureHeader(SECRET, payload, Math.floor(Date.now() / 1000)),
      },
      payload,
    });
  };

  beforeAll(async () => {
    await migrate(pool);
  });
  beforeEach(async () => {
    await pool.query(
      "TRUNCATE outbox, rejected_events, leads, raw_events RESTART IDENTITY CASCADE",
    );
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("rejects a bad signature without persisting anything", async () => {
    const res = await post(
      { source: "web", email: "a@b.com" },
      `t=${Math.floor(Date.now() / 1000)},v1=${"00".repeat(32)}`,
    );
    expect(res.statusCode).toBe(401);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM raw_events");
    expect(rows[0].n).toBe(0);
  });

  it("accepts a lead, then treats a replay as a duplicate", async () => {
    const lead = { source: "web", email: "Jane@Acme.com", company: "Acme" };
    const first = await post(lead);
    expect(first.statusCode).toBe(201);
    const second = await post({ ...lead, email: "jane@acme.com" });
    expect(second.statusCode).toBe(200);
    expect(second.json().status).toBe("duplicate");
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM leads");
    expect(rows[0].n).toBe(1);
    const outbox = await pool.query("SELECT count(*)::int AS n FROM outbox WHERE status='pending'");
    expect(outbox.rows[0].n).toBe(1);
  });

  it("rejects a correctly signed but stale request (replay protection)", async () => {
    const payload = JSON.stringify({ source: "web", email: "a@b.com" });
    const old = Math.floor(Date.now() / 1000) - 3600;
    const res = await post(
      { source: "web", email: "a@b.com" },
      signatureHeader(SECRET, payload, old),
    );
    expect(res.statusCode).toBe(401);
  });

  it("protects /metrics with a bearer token", async () => {
    expect((await app.inject({ method: "GET", url: "/metrics" })).statusCode).toBe(401);
    const ok = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: `Bearer ${"m".repeat(20)}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toContain("lead_outbox_dead");
  });

  it("quarantines invalid payloads and keeps the raw event", async () => {
    const res = await post({ source: "web", email: "not-an-email" });
    expect(res.statusCode).toBe(422);
    const raw = await pool.query("SELECT count(*)::int AS n FROM raw_events");
    const rej = await pool.query("SELECT count(*)::int AS n FROM rejected_events");
    expect(raw.rows[0].n).toBe(1);
    expect(rej.rows[0].n).toBe(1);
  });
});
