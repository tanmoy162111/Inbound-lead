import type pg from "pg";

export interface ErasureCounts {
  leads: number;
  rawEvents: number;
  rejectedEvents: number;
  outbox: number;
}

async function deleteByLeadAndRawIds(
  client: pg.PoolClient,
  leadIds: string[],
  rawIds: string[],
): Promise<ErasureCounts> {
  const outbox = await client.query("DELETE FROM outbox WHERE lead_id = ANY($1::bigint[])", [
    leadIds,
  ]);
  const rejected = await client.query(
    "DELETE FROM rejected_events WHERE raw_event_id = ANY($1::bigint[])",
    [rawIds],
  );
  const leads = await client.query("DELETE FROM leads WHERE id = ANY($1::bigint[])", [leadIds]);
  const raw = await client.query("DELETE FROM raw_events WHERE id = ANY($1::bigint[])", [rawIds]);
  return {
    leads: leads.rowCount ?? 0,
    rawEvents: raw.rowCount ?? 0,
    rejectedEvents: rejected.rowCount ?? 0,
    outbox: outbox.rowCount ?? 0,
  };
}

async function inTransaction<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Right-to-erasure: removes every local trace of one email address. Does NOT touch the CRM. */
export function eraseByEmail(pool: pg.Pool, email: string): Promise<ErasureCounts> {
  const e = email.trim().toLowerCase();
  return inTransaction(pool, async (c) => {
    const leads = await c.query<{ id: string; raw_event_id: string }>(
      "SELECT id, raw_event_id FROM leads WHERE email = $1",
      [e],
    );
    const raws = await c.query<{ id: string }>(
      "SELECT id FROM raw_events WHERE lower(trim(payload->>'email')) = $1",
      [e],
    );
    const rawIds = [
      ...new Set([...leads.rows.map((r) => r.raw_event_id), ...raws.rows.map((r) => r.id)]),
    ];
    // Leads that point at one of these raw events must go too (FK), even under another email.
    const linked = await c.query<{ id: string }>(
      "SELECT id FROM leads WHERE raw_event_id = ANY($1::bigint[])",
      [rawIds],
    );
    const leadIds = [...new Set([...leads.rows.map((r) => r.id), ...linked.rows.map((r) => r.id)])];
    return deleteByLeadAndRawIds(c, leadIds, rawIds);
  });
}

/** Storage limitation: deletes leads (and their raw/rejected/outbox rows) older than `months`. */
export function purgeExpiredLeads(pool: pg.Pool, months: number): Promise<ErasureCounts> {
  return inTransaction(pool, async (c) => {
    const old = await c.query<{ id: string; raw_event_id: string }>(
      "SELECT id, raw_event_id FROM leads WHERE created_at < now() - make_interval(months => $1)",
      [months],
    );
    return deleteByLeadAndRawIds(
      c,
      old.rows.map((r) => r.id),
      old.rows.map((r) => r.raw_event_id),
    );
  });
}
