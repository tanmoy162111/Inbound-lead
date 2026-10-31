import { HttpRouter, LogRouter } from "./adapters/router.js";
import { loadEnv } from "./config/env.js";
import { createPool } from "./db/client.js";
import { redactOldRawEvents } from "./db/retention.js";
import { startOutboxWorker } from "./ingest/outbox.js";
import { buildServer } from "./ingest/server.js";

const env = loadEnv();
const pool = createPool(env.DATABASE_URL);
const app = buildServer({
  pool,
  webhookSecret: env.WEBHOOK_SECRET,
  rateLimitMax: env.RATE_LIMIT_MAX,
  trustProxy: env.TRUST_PROXY,
  logLevel: env.LOG_LEVEL,
});

const log = (obj: object, msg: string) => app.log.info(obj, msg);
const router = env.DESTINATION_URL
  ? new HttpRouter(env.DESTINATION_URL, env.DESTINATION_TOKEN)
  : new LogRouter(log);
const stopWorker = startOutboxWorker(pool, router, log, 2000, {
  maxAttempts: env.OUTBOX_MAX_ATTEMPTS,
});

const purge = () =>
  redactOldRawEvents(pool, env.RAW_RETENTION_DAYS)
    .then((n) => n && log({ redacted: n }, "raw payloads redacted"))
    .catch((err) => app.log.error({ err: String(err) }, "retention job failed"));
void purge();
const purgeTimer = setInterval(purge, 60 * 60 * 1000);

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(purgeTimer);
  await app.close();
  await stopWorker();
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: env.PORT, host: "0.0.0.0" });
