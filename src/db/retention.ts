import type pg from "pg";

/**
 * Redacts raw payloads (PII) older than `days`. Rows stay so foreign keys and audit
 * trails survive; the normalized lead record is governed separately.
 */
export async function redactOldRawEvents(pool: pg.Pool, days: number): Promise<number> {
  const res = await pool.query(
    `UPDATE raw_events SET payload = '{"redacted":true}'::jsonb
      WHERE received_at < now() - make_interval(days => $1)
        AND payload <> '{"redacted":true}'::jsonb`,
    [days],
  );
  return res.rowCount ?? 0;
}
