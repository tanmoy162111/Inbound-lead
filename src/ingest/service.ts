import type pg from "pg";
import { idempotencyKey } from "../pipeline/dedupe.js";
import { normalizeLead } from "../pipeline/normalize.js";
import { scoreLead } from "../pipeline/score.js";
import { validateInbound } from "../pipeline/validate.js";

export type IntakeOutcome =
  | { status: "accepted"; leadId: number }
  | { status: "duplicate"; leadId: number }
  | { status: "rejected"; reason: string };

/** receive -> persist raw -> validate -> normalize -> dedupe -> score -> record + enqueue (outbox) */
export async function intake(
  pool: pg.Pool,
  source: string,
  payload: unknown,
): Promise<IntakeOutcome> {
  // Persist first: the raw payload is durable before any processing.
  const raw = await pool.query<{ id: string }>(
    "INSERT INTO raw_events (source, payload) VALUES ($1, $2) RETURNING id",
    [source, JSON.stringify(payload ?? null)],
  );
  const rawId = Number(raw.rows[0]?.id);

  const validated = validateInbound(payload);
  if (!validated.ok) {
    await pool.query("INSERT INTO rejected_events (raw_event_id, reason) VALUES ($1, $2)", [
      rawId,
      validated.reason,
    ]);
    return { status: "rejected", reason: validated.reason };
  }

  const lead = normalizeLead(validated.value);
  const key = idempotencyKey(lead);
  const score = scoreLead(lead);

  // Lead + outbox job commit together: delivery to the destination happens later, with retries.
  const client = await pool.connect();
  let inserted: { rowCount: number | null; rows: { id: string }[] };
  try {
    await client.query("BEGIN");
    inserted = await client.query<{ id: string }>(
      `INSERT INTO leads (raw_event_id, idempotency_key, source, email, name, phone, company, message, score)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        rawId,
        key,
        lead.source,
        lead.email,
        lead.name,
        lead.phone,
        lead.company,
        lead.message,
        score,
      ],
    );
    if (inserted.rowCount) {
      await client.query("INSERT INTO outbox (lead_id) VALUES ($1)", [inserted.rows[0]?.id]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  if (inserted.rowCount === 0) {
    const existing = await pool.query<{ id: string }>(
      "SELECT id FROM leads WHERE idempotency_key = $1",
      [key],
    );
    return { status: "duplicate", leadId: Number(existing.rows[0]?.id) };
  }

  const leadId = Number(inserted.rows[0]?.id);
  return { status: "accepted", leadId };
}
