import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool } from "../../src/db/client.js";
import { migrate } from "../../src/db/migrate.js";
import { redactOldRawEvents } from "../../src/db/retention.js";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("redactOldRawEvents", () => {
  const pool = createPool(url ?? "");
  beforeAll(async () => {
    await migrate(pool);
    await pool.query(
      "TRUNCATE outbox, rejected_events, leads, raw_events RESTART IDENTITY CASCADE",
    );
  });
  afterAll(() => pool.end());

  it("redacts only payloads older than the cutoff", async () => {
    await pool.query(
      `INSERT INTO raw_events (source, payload, received_at) VALUES
       ('web','{"email":"old@x.com"}', now() - interval '40 days'),
       ('web','{"email":"new@x.com"}', now())`,
    );
    expect(await redactOldRawEvents(pool, 30)).toBe(1);
    expect(await redactOldRawEvents(pool, 30)).toBe(0);
    const { rows } = await pool.query("SELECT payload FROM raw_events ORDER BY id");
    expect(rows[0].payload).toEqual({ redacted: true });
    expect(rows[1].payload).toEqual({ email: "new@x.com" });
  });
});
