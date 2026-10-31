# CLAUDE.md — Inbound Lead Intake

Guidance for Claude Code when working in this repository. Derived from the global dev-environment file (`~/AGENTS.md`) plus engineering practices for this project.

## Project

**Inbound Lead Intake** — ingest inbound leads (forms, email, webhooks), validate and normalize them, dedupe, enrich/score, and route to the right destination (CRM, notification, queue).

> Status: v0.1 scaffold — signed webhook → durable raw store → validate → normalize → dedupe → score → record + outbox → background worker delivers to destination (retries, backoff, dead letter).

- Stack: TypeScript (strict, ESM) on Node 24, pnpm, Fastify 5 (+ @fastify/rate-limit), zod 4, `pg` (raw SQL), Biome (lint+format), Vitest.
- Entry points: `src/index.ts` (server), `src/db/migrate.ts` (migrations).
- Key files: `src/ingest/service.ts` (pipeline orchestration), `src/ingest/server.ts` (routes), `src/pipeline/*` (pure stages), `src/ingest/outbox.ts` (delivery worker), `src/adapters/router.ts` (`LeadRouter`: `LogRouter` default, `HubSpotRouter` when `HUBSPOT_ACCESS_TOKEN` is set, else `HttpRouter` when `DESTINATION_URL` is set), `migrations/*.sql`.
- Endpoints: `POST /webhooks/leads` (header `x-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">` using `WEBHOOK_SECRET`, ±300 s tolerance; 201 accepted, 200 duplicate, 422 rejected, 401 bad/stale signature, 429 rate limited), `GET /healthz`, `GET /readyz`, `GET /metrics` (only when `METRICS_TOKEN` is set; Bearer auth; Prometheus gauges incl. `lead_outbox_dead` and `lead_outbox_oldest_pending_seconds` — alert on dead > 0 and age > ~15 min).

### Commands

```bash
pnpm install            # esbuild build script is allowed via pnpm-workspace.yaml
pnpm migrate            # apply migrations/*.sql to DATABASE_URL
pnpm dev                # watch mode (loads .env if present)
pnpm check              # lint + typecheck + tests (run before every PR)
pnpm test               # vitest (integration tests skip if TEST_DATABASE_URL is unset)
pnpm format             # biome check --write
pnpm erase <email>      # right-to-erasure: deletes all local rows for an email (then delete in the CRM too)
pnpm build              # tsc -> dist/ ; run with `pnpm start:prod`, migrate with `pnpm migrate:prod`
docker build -t lead-intake .   # multi-stage, non-root; run migrate:prod as a release step
```

Local setup: copy `.env.example` to `.env`, fill in credentials from `~/AGENTS.md`. Databases `lead_intake` and `lead_intake_test` exist on the local Postgres. Integration tests TRUNCATE tables — only ever point `TEST_DATABASE_URL` at the test DB.

### Gotchas
- The project path contains spaces; compare `import.meta.url` via `pathToFileURL`, never string-built `file://` URLs.
- Webhook HMAC must be computed over the raw body string (captured in the content-type parser), not re-serialized JSON.
- Delivery is at-least-once: routers must be safe to call twice (HttpRouter sends `idempotency-key: lead-<id>`). A router must THROW on failure so the outbox retries.
- Dead-lettered rows stay in `outbox` with `status='dead'` and `last_error`; inspect with `SELECT * FROM outbox WHERE status='dead'`, requeue by setting `status='pending', attempts=0, next_attempt_at=now()`.
- Outbox batches hold row locks during the HTTP call (10 s timeout); fine at low volume, revisit with claim-then-release if throughput grows.
- Behind a reverse proxy set `TRUST_PROXY=true`, otherwise rate limiting sees the proxy IP.
- `src/db/retention.ts` redacts `raw_events.payload` older than `RAW_RETENTION_DAYS` (hourly job in `index.ts`). Leads (and their raw/rejected/outbox rows) are deleted after `LEAD_RETENTION_MONTHS` (default 24; sources suggest 12-24 months of inactivity as a common benchmark — vendor blogs, not regulators; confirm against your lawful basis). `pnpm erase <email>` does per-person erasure locally but does NOT touch HubSpot.
- HubSpot: `HubSpotRouter` does search-by-email → PATCH, else POST (409 race re-searches). Chosen over batch upsert because email-as-idProperty upserts have reported 400 errors. It is unit-tested with mocked fetch only; verify once against a real portal (private app with contacts read+write scopes). The `message` property is HubSpot's standard contact field; map `score` to a custom property if wanted.
- Dedupe key is `sha256(source + email)`; changing it changes what counts as a duplicate.

## Machine Environment (from global config)

- Ubuntu 26.04, Zsh + Oh My Zsh, 20 GB RAM, Ryzen 5 5500U — avoid heavy parallel builds/containers.
- Runtimes: Node v24 (fnm), pnpm 11, Bun, Python 3.14 (pyenv, uv, pipx), Rust 1.96, Go 1.26.
- Prefer `pnpm` for Node, `uv` for Python.
- Databases (local dev only):
  - PostgreSQL 18 (native, :5432) — `psql -U tanmoy -d tanmoy`. Create a dedicated database/schema for this project; don't use the default `tanmoy` DB.
  - Redis 7 (Docker `redis-dev`, :6379), MongoDB 7 (Docker `mongo-dev`, :27017).
  - Start Docker DBs: `docker compose -f ~/docker/dbs/docker-compose.yml up -d`
  - Credentials live in `~/AGENTS.md`; never copy them into this repo. Use `.env` (gitignored) and commit only `.env.example`.
- Tooling available: `rg`, `fd`, `jq`, `gh`, `docker`, `kubectl`, `terraform`/`tofu`, `lazygit`.
- Shell aliases (`g`, `gst`, `dc`, `pn`, `cat`=bat, `ls`=eza) exist interactively; in scripts use the real commands.

## Working Agreements

1. **Read before writing.** Inspect existing code and conventions first; match them.
2. **Smallest change that solves the problem.** No drive-by refactors, speculative abstractions, or unrequested features.
3. **Verify, don't assume.** Run tests/linters/type-checks before claiming done; report failures honestly.
4. **Ask before irreversible or outward-facing actions** (force-push, deleting data, dropping tables, sending real emails/webhooks, deploying).
5. **Commit only when asked.** Use Conventional Commits (`feat:`, `fix:`, `chore:`, …); small, atomic commits; branch off `main`.
6. Keep this file accurate — if a command or convention here is wrong, fix it.

## Engineering Practices

### Design
- Model the lead pipeline as explicit stages: **receive → validate → normalize → dedupe → enrich/score → route → record**. Each stage is a pure, testable unit with typed input/output.
- Separate I/O (HTTP, DB, queues, third-party APIs) from business logic; inject dependencies.
- Prefer boring, well-understood tech; add a dependency only with a clear reason.
- Record significant decisions as short ADRs in `docs/adr/`.

### Reliability (critical for lead intake — a dropped lead is lost revenue)
- **Persist first, process after.** Durably store the raw payload before any processing; acknowledge to the sender only after it is stored.
- **Idempotency:** derive an idempotency key per lead (source + external id, or hash of normalized email + timestamp window). Retries and duplicate webhooks must never create duplicates.
- **Retries with backoff + jitter** for downstream calls; dead-letter queue for poison messages; nothing silently dropped.
- Timeouts on every network call; circuit-breaker or bounded retries for flaky CRMs.
- Handle out-of-order and replayed events; make processing replayable from stored raw payloads.

### Data & Privacy (leads contain PII)
- Treat name, email, phone, company, and message content as PII: don't log it raw; mask in logs (`j***@example.com`).
- Collect only fields needed; define retention and deletion paths (GDPR/CCPA-style erasure requests).
- Validate and normalize at the boundary (email, E.164 phone, country, URL); reject or quarantine invalid input with a reason, never guess.
- Encrypt in transit (TLS) and protect at rest; least-privilege DB roles; migrations are versioned, reversible where practical, and reviewed before applying.

### Security
- Never commit secrets, tokens, or credentials. Load from environment; keep `.env` out of git.
- Verify webhook authenticity (HMAC signature + timestamp tolerance) and rate-limit public endpoints.
- Validate all external input against a schema (e.g. zod / pydantic); use parameterized queries only.
- Defend against spam/bots (honeypot, rate limits, captcha where appropriate) and header/CSV/HTML injection in lead content.
- Keep dependencies pinned via lockfile; run an audit (`pnpm audit` / `pip-audit` / `cargo audit`) periodically.

### Code Quality
- Strict typing on (TypeScript `strict`, `mypy`/`pyright`, etc.). No `any`/untyped escape hatches without a comment.
- Formatter + linter configured and enforced (pre-commit and CI); don't hand-format.
- Functions small and single-purpose; names describe domain intent (`normalizePhone`, not `fix`).
- Comments explain *why*, not *what*. No dead code, no commented-out blocks, no TODOs without an issue/owner.
- Errors: fail loudly with typed, actionable errors; never swallow exceptions; include context but no PII.

### Testing
- Test pyramid: many unit tests (pipeline stages, normalizers, scoring), fewer integration tests (DB, queue, webhook endpoint), few end-to-end.
- Write a failing test first for bug fixes; add regression tests for every production incident.
- Use realistic fixtures incl. edge cases: duplicate leads, unicode names, malformed emails/phones, empty fields, oversized payloads, replayed webhooks.
- Tests must be deterministic and isolated (no shared state, no real third-party calls — use fakes/recorded fixtures). Use a throwaway DB/schema for integration tests.
- Don't mock what you own when a real local Postgres/Redis is available.

### Observability
- Structured JSON logs with a correlation/lead id on every line; log levels used consistently.
- Metrics: leads received, accepted, rejected (by reason), duplicates, routing latency, downstream error rate, queue depth/age.
- Health (`/healthz`) and readiness (`/readyz`) endpoints; alert on stuck queue, rising reject rate, and downstream failures.

### Git & Review
- Trunk-based: short-lived branches from `main`, PRs small and focused, each with description, test evidence, and rollback note.
- Never force-push `main`; never rewrite shared history.
- Run format, lint, type-check, and tests locally before opening a PR.

### Ops
- Twelve-factor config: everything environment-specific via env vars; document each in `.env.example`.
- Reproducible local setup: one documented command to bring up dependencies and run the app.
- Dockerfile: multi-stage, non-root user, pinned base image, minimal final image.
- CI runs: install (frozen lockfile) → lint → type-check → test → build. Deploys are automated, with a rollback path.

## Layout

```
src/
  ingest/       # webhook server, signature check, intake service
  pipeline/     # validate, normalize, dedupe, score (pure logic)
  adapters/     # destination routers (CRM, Slack, queue) — currently LogRouter
  db/           # pool + migration runner
  config/       # typed env loading
migrations/     # ordered SQL files
tests/          # unit/ and integration/
docs/adr/       # architecture decision records
```

## Next Steps
- Smoke-test `HubSpotRouter` against a real HubSpot portal/sandbox; add a custom `lead_score` contact property.
- Wire `/metrics` into a Prometheus/Grafana (or hosted) alert for dead letters and outbox age.
- Propagate erasure to HubSpot (GDPR delete endpoint) once the portal is connected.
- Record lawful basis and retention periods in the Article 30 processing record (outside the repo).

## Open Questions (resolve and record here)

- Lead sources in scope (web form, email parsing, ads platforms, webhooks)?
- Notification channels beyond the CRM (Slack/email for hot leads)?
- Scoring/enrichment: currently rule-based (`src/pipeline/score.ts`); LLM-assisted? (If LLM: use latest Claude models, validate structured output, never trust model output without schema validation.)
- Volume and latency expectations; retention period for raw payloads.
