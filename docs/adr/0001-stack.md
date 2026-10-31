# ADR 0001: TypeScript + Fastify + Postgres

**Status:** accepted

**Context:** Greenfield lead-intake service on a 20 GB dev machine with Node 24, pnpm and native Postgres already installed.

**Decision:** TypeScript (strict) on Node, Fastify for HTTP, zod for boundary validation, raw SQL via `pg`, Postgres for durable storage (raw events, leads, quarantined rejects), Biome + Vitest for tooling.

**Consequences:** One language across ingest and pipeline; schema-validated input; raw payloads are persisted before processing so any stage can be replayed. Raw SQL keeps the dependency surface small; revisit an ORM/query builder if the schema grows.

## Addendum: delivery and webhook security

- **Transactional outbox** (`outbox` table) decouples intake from the destination: the lead and its delivery job commit atomically; a worker claims due rows with `FOR UPDATE SKIP LOCKED`, retries with exponential backoff + jitter, and dead-letters after `OUTBOX_MAX_ATTEMPTS`. Delivery is at-least-once, so destinations get an `idempotency-key`.
- **Timestamped HMAC** (`t=...,v1=...` over `"<t>.<body>"`, 5-minute tolerance) so captured requests cannot be replayed; constant-time comparison.
- **Per-IP rate limiting** on the public API; health probes exempt.
