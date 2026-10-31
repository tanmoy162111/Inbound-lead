import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import type pg from "pg";
import { intake } from "./service.js";
import { verifySignature } from "./signature.js";

export interface ServerDeps {
  pool: pg.Pool;
  rateLimitMax?: number;
  trustProxy?: boolean;
  webhookSecret: string;
  logLevel?: string;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({
    logger: { level: deps.logLevel ?? "info" },
    bodyLimit: 64 * 1024,
    trustProxy: deps.trustProxy ?? false,
  });

  // Keep the raw body so the HMAC is computed over exactly what was sent.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    (req as unknown as { rawBody: string }).rawBody = body as string;
    try {
      done(null, body ? JSON.parse(body as string) : null);
    } catch {
      done(Object.assign(new Error("Invalid JSON"), { statusCode: 400 }), undefined);
    }
  });

  // Per-IP limit (health probes are exempt). Behind a proxy, set trustProxy.
  app.register(rateLimit, { max: deps.rateLimitMax ?? 120, timeWindow: "1 minute" });

  app.get("/healthz", { config: { rateLimit: false } }, async () => ({ ok: true }));
  app.get("/readyz", { config: { rateLimit: false } }, async (_req, reply) => {
    try {
      await deps.pool.query("SELECT 1");
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  app.post("/webhooks/leads", async (req, reply) => {
    const raw = (req as unknown as { rawBody?: string }).rawBody ?? "";
    const sig = req.headers["x-signature"];
    if (!verifySignature(deps.webhookSecret, raw, typeof sig === "string" ? sig : undefined)) {
      return reply.code(401).send({ error: "invalid signature" });
    }
    const body = req.body as { source?: unknown } | null;
    const source = typeof body?.source === "string" ? body.source.slice(0, 64) : "unknown";
    const outcome = await intake(deps.pool, source, req.body);
    if (outcome.status === "rejected") return reply.code(422).send(outcome);
    return reply.code(outcome.status === "accepted" ? 201 : 200).send(outcome);
  });

  return app;
}
