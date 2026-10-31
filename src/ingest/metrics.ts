import type pg from "pg";

/** Prometheus text exposition of the numbers worth alerting on. */
export async function renderMetrics(pool: pg.Pool): Promise<string> {
  const { rows } = await pool.query<{
    pending: number;
    dead: number;
    oldest_pending_seconds: number;
    leads: number;
    rejected: number;
  }>(`SELECT
        (SELECT count(*)::int FROM outbox WHERE status='pending') AS pending,
        (SELECT count(*)::int FROM outbox WHERE status='dead') AS dead,
        COALESCE((SELECT extract(epoch FROM now() - min(created_at))::int
                    FROM outbox WHERE status='pending'), 0) AS oldest_pending_seconds,
        (SELECT count(*)::int FROM leads) AS leads,
        (SELECT count(*)::int FROM rejected_events) AS rejected`);
  const r = rows[0];
  const lines = [
    ["lead_outbox_pending", "Deliveries waiting or retrying", r?.pending],
    ["lead_outbox_dead", "Deliveries given up on (needs attention)", r?.dead],
    [
      "lead_outbox_oldest_pending_seconds",
      "Age of oldest undelivered lead",
      r?.oldest_pending_seconds,
    ],
    ["lead_total", "Leads stored", r?.leads],
    ["lead_rejected_total", "Payloads quarantined as invalid", r?.rejected],
  ].flatMap(([name, help, v]) => [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} gauge`,
    `${name} ${v ?? 0}`,
  ]);
  return `${lines.join("\n")}\n`;
}
