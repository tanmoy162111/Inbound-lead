import type pg from "pg";
import type { LeadRouter, RoutableLead } from "../adapters/router.js";

export interface OutboxOptions {
  batchSize?: number;
  maxAttempts?: number;
  baseDelaySeconds?: number;
  maxDelaySeconds?: number;
  random?: () => number;
}

/** Exponential backoff with jitter: base * 2^attempts, capped, scaled by 0.5-1.0. */
export function backoffSeconds(attempts: number, o: OutboxOptions = {}): number {
  const base = o.baseDelaySeconds ?? 5;
  const max = o.maxDelaySeconds ?? 3600;
  const jitter = 0.5 + 0.5 * (o.random ?? Math.random)();
  return Math.max(1, Math.round(Math.min(base * 2 ** attempts, max) * jitter));
}

/**
 * Delivers due outbox rows. Rows are claimed with FOR UPDATE SKIP LOCKED so several
 * workers can run safely. Delivery is at-least-once; routers must tolerate repeats.
 */
export async function processOutboxBatch(
  pool: pg.Pool,
  router: LeadRouter,
  o: OutboxOptions = {},
): Promise<{ delivered: number; retried: number; dead: number }> {
  const maxAttempts = o.maxAttempts ?? 8;
  const stats = { delivered: 0, retried: 0, dead: 0 };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<RoutableLead & { outbox_id: string; attempts: number }>(
      `SELECT o.id AS outbox_id, o.attempts, l.id::int AS id, l.source, l.email, l.name,
              l.phone, l.company, l.message, l.score
         FROM outbox o JOIN leads l ON l.id = o.lead_id
        WHERE o.status = 'pending' AND o.next_attempt_at <= now()
        ORDER BY o.id
        LIMIT $1
        FOR UPDATE OF o SKIP LOCKED`,
      [o.batchSize ?? 20],
    );
    for (const { outbox_id, attempts, ...lead } of rows) {
      try {
        await router.route(lead);
        await client.query(
          "UPDATE outbox SET status='done', attempts=attempts+1, last_error=NULL, updated_at=now() WHERE id=$1",
          [outbox_id],
        );
        stats.delivered++;
      } catch (err) {
        const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
        const next = attempts + 1;
        if (next >= maxAttempts) {
          await client.query(
            "UPDATE outbox SET status='dead', attempts=$2, last_error=$3, updated_at=now() WHERE id=$1",
            [outbox_id, next, message],
          );
          stats.dead++;
        } else {
          await client.query(
            `UPDATE outbox SET attempts=$2, last_error=$3, updated_at=now(),
                    next_attempt_at = now() + make_interval(secs => $4)
              WHERE id=$1`,
            [outbox_id, next, message, backoffSeconds(attempts, o)],
          );
          stats.retried++;
        }
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return stats;
}

/** Simple poll loop; returns a stop function that waits for the in-flight batch. */
export function startOutboxWorker(
  pool: pg.Pool,
  router: LeadRouter,
  log: (obj: object, msg: string) => void,
  intervalMs = 2000,
  o: OutboxOptions = {},
): () => Promise<void> {
  let stopped = false;
  let inflight: Promise<unknown> = Promise.resolve();
  const timer = setInterval(() => {
    inflight = inflight.then(async () => {
      if (stopped) return;
      try {
        const s = await processOutboxBatch(pool, router, o);
        if (s.dead) log(s, "ALERT: outbox entries moved to dead letter");
      } catch (err) {
        log({ err: err instanceof Error ? err.message : String(err) }, "outbox batch failed");
      }
    });
  }, intervalMs);
  return async () => {
    stopped = true;
    clearInterval(timer);
    await inflight;
  };
}
