# CLAUDE.md — Inbound Lead Intake

Project-specific facts and exact commands. Global rules (from `~/.claude/CLAUDE.md`) follow below; this section wins on conflict.


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


## Layout

```
src/ingest/    webhook server, signature check, intake service, outbox worker, metrics
src/pipeline/  validate, normalize, dedupe, score (pure logic)
src/adapters/  destination routers (Log, Http, HubSpot)
src/db/        pool, migrations, retention, erasure
src/config/    typed env loading
migrations/    ordered SQL files (forward-only)
tests/         unit/ and integration/
docs/          adr/, runbook.md
```

Git hooks: `.githooks/pre-commit` runs `pnpm check` (installed by `pnpm install` via `prepare`).

---

# Global Instructions (~/.claude/CLAUDE.md)

Applies to every project. A project's own CLAUDE.md overrides this file where they conflict.
Plugins in use: **Superpowers** (engineering discipline), **GSD** (project orchestration), **ECC** (specialist agents, security, hooks).
These instructions are the user's explicit instructions — they take precedence over plugin skill defaults.

## Me
- Solo builder shipping real products end to end; I want working, deployed software, not demos.
- Explain decisions briefly in plain English; no lectures. Ask when a choice is expensive to reverse.
- <!-- EDIT: OS, preferred languages, package managers, cloud, timezone -->

## Non-negotiables
- **Verify before claiming done.** Run the tests/build/lint and show the output. "Should work" is not done.
- **Never guess library APIs, versions, prices, or model IDs** — check official docs (Context7 MCP if available, else web) for anything version-sensitive.
- **Confirm package names exist** on the registry before adding a dependency; prefer well-maintained, widely used packages. Pin via lockfile.
- **Ask before destructive or irreversible actions**: `rm -rf`, dropping/migrating prod data, force-push, rewriting published history, deleting branches, changing prod infra, spending money, sending external messages.
- **Secrets**: never hardcode, print, commit, or paste into prompts/logs. Use `.env` (git-ignored) + `.env.example`; prod secrets in a secret manager.
- **Stay in scope.** No drive-by refactors or "improvements" outside the task; note them as follow-ups instead.
- **Small, reversible steps.** One logical change per commit; keep the build green.
- If instructions, the plan, and the code disagree — stop and ask, don't pick silently.

## Plugin routing — one owner per job
Rule: **exactly one planner per piece of work.** Never run two planning systems on the same task.

**Choose the track at the start of every task:**
| Situation | Track |
|---|---|
| New product / multi-week work / >1 context window / repo has `.planning/` | **GSD track** |
| Feature, bugfix, or refactor that fits in one session | **Superpowers track** |
| Tiny change (typo, config, copy, one-liner) | **Direct** — just do it, then verify |
| Throwaway spike / prototype to learn something | **Direct**, in a scratch branch; TDD optional; never merge spike code as-is |

**GSD track** (GSD owns planning + state; Superpowers owns code quality inside execution)
- Greenfield: `/gsd-new-project` → per phase: `/gsd-discuss-phase N` → (`/gsd-ui-phase N` for UI) → `/gsd-plan-phase N` → `/gsd-execute-phase N` → `/gsd-code-review N` → `/gsd-verify-work N` → `/gsd-ship N`.
- Brownfield: `/gsd-map-codebase` first, then `/gsd-new-project`.
- Milestones: `/gsd-complete-milestone` → `/gsd-new-milestone`. Small ad-hoc task in a GSD repo: `/gsd-quick`.
- Session continuity: `/gsd-pause-work` / `/gsd-resume-work` / `/gsd-progress`. Run `/clear` between phases.
- Inside GSD phases, **skip `superpowers:brainstorming` and `superpowers:writing-plans`** (discuss/plan-phase already did that). **Do apply** `test-driven-development`, `systematic-debugging`, `verification-before-completion`.
- Do not use `/ecc:plan` in a GSD repo.
- Older GSD installs use `/gsd:<cmd>` instead of `/gsd-<cmd>` — use whichever `/help` shows.

**Superpowers track** (Superpowers owns everything; ECC supplies specialists)
`brainstorming` (design; one question at a time; get approval) → `using-git-worktrees` → `writing-plans` → `subagent-driven-development` (or `executing-plans`) with `test-driven-development` → `requesting-code-review` → `verification-before-completion` → `finishing-a-development-branch`.
- Bugs: `systematic-debugging` first — root cause before any fix. Independent failures: `dispatching-parallel-agents`.
- Review feedback: `receiving-code-review` — verify each point technically; don't blindly accept.

**ECC — specialists and gates (use in either track)**
- Build/type errors: `/build-fix` or the `build-error-resolver` agent.
- Security: `security-reviewer` agent for auth, payments, file upload, user input, secrets, AI tool-use code; `/security-scan` (AgentShield) on Claude config/MCP changes and before release.
- Language/DB review: matching `*-reviewer` agent (e.g. `typescript-reviewer`, `python-reviewer`, `database-reviewer`) alongside the Superpowers/GSD review.
- Hygiene: `/refactor-clean` (dead code), `/test-coverage`, `/update-docs`, E2E via the `e2e-testing` skill / `e2e-runner` agent.
- Context: `/context-budget` when context feels heavy; `/save-session` / `/resume-session` outside GSD repos.
- Do not use ECC's TDD or plan commands when Superpowers/GSD already own that step.
- If a plugin command name collides, use the namespaced form (e.g. `/ecc:<cmd>`, `superpowers:<skill>`).

## Lifecycle: scratch → production
1. **Frame** — problem, user, success metric, constraints, non-goals. Write it down (GSD: PROJECT.md; else `docs/spec.md`).
2. **Decide stack** — boring, well-documented tech I can deploy cheaply. Record big choices as short ADRs in `docs/adr/`. Check current versions in docs.
3. **Scaffold** — repo, `README` (run/test/deploy in ≤10 lines), `.gitignore`, `.env.example`, formatter, linter, typecheck, test runner, pre-commit hooks, CI running all of them. Project `CLAUDE.md` with exact commands.
4. **Walking skeleton** — thinnest end-to-end slice deployed to a real staging URL early. Deployment pain found in week 1, not week 6.
5. **Build** in vertical slices via the chosen track. Tests first for logic; tests alongside for UI/glue.
6. **Harden** — error handling at boundaries, input validation, authz on every endpoint, rate limits, logging, empty/loading/error states in UI, accessibility basics.
7. **Release gate** (all must pass): tests + lint + typecheck + build green in CI; security review done; no secrets in diff; migrations reversible; env vars documented; observability in place; rollback plan written.
8. **Deploy** — staging first, smoke test, then prod. Prefer canary/blue-green or at least instant rollback. Run DB migrations as a separate, backward-compatible step (expand → migrate → contract).
9. **Operate** — health checks, uptime alerts, error tracking (e.g. Sentry), structured logs, dashboards, backups with a tested restore. After incidents: short blameless postmortem + a regression test.

## Engineering standards
- **Code**: clear names over comments; comments explain *why*. Small functions, early returns, no dead code, no commented-out code. Follow the repo's existing patterns before introducing new ones.
- **Types/validation**: strict mode on (TS `strict`, mypy/pyright). Validate all external input at the boundary (Zod / Pydantic).
- **Errors**: never swallow; fail loudly in dev, gracefully in prod; user-facing messages without internals.
- **Tests**: test behaviour, not implementation. Unit for logic, integration for DB/API, a few E2E for critical journeys. A bug fix starts with a failing test. Don't mock what you own unless necessary; never weaken a test to make it pass.
- **Data**: migrations in version control; never edit an applied migration; index foreign keys and hot query columns; parameterised queries only.
- **APIs**: consistent error shape, pagination, idempotency keys for mutations that may retry, versioning when public.
- **Frontend**: semantic HTML, keyboard + screen-reader basics, responsive, handle loading/empty/error, measure Core Web Vitals before optimising.
- **Performance**: measure before optimising; fix N+1s; cache with explicit invalidation.
- **Dependencies**: justify each new one; prefer stdlib/platform features; keep lockfiles committed; run audit tools in CI.

## Git & PRs
- Branch per task (`feat/…`, `fix/…`, `chore/…`); worktrees for parallel work. Never commit directly to `main` on shared repos.
- Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`); message says why, not just what.
- Never `--no-verify`, never force-push shared branches, never commit generated secrets/build output.
- PR description: what/why, how tested (commands + results), risks, rollback, screenshots for UI.

## AI / LLM features
When building or changing anything LLM-powered (RAG, chatbots, agents, tool calling, MCP servers, embeddings, prompts, evals), **load the `ai-systems-playbook` skill first** and follow its decision ladder and launch checklist.
Minimum bar even for small AI features: eval set before tuning, prompts and model IDs versioned and pinned, token/loop/$ limits, retrieved and user content treated as untrusted, PII kept out of logs.

## Security baseline (every project)
- AuthN via a proven provider/library; authZ checked server-side on every request; deny by default.
- OWASP Top 10 mindset: escape output, parameterise queries, CSRF protection for cookie auth, secure headers, CORS allowlist.
- Least privilege for every credential, service account, and agent tool. Rotate on suspicion.
- Dependency + container scanning in CI. Review any new MCP server or plugin before installing — it runs with my credentials.

## Working style
- For non-trivial work: restate the goal + plan in 3–6 bullets before editing, then execute without asking for approval at every step.
- Read before writing: inspect relevant files, tests, and conventions first. Use subagents for wide codebase searches to keep main context clean.
- Context hygiene: `/clear` between unrelated tasks; `/compact` with a focus note around 50–60% usage; long tasks → write progress to a file (GSD STATE.md or `docs/progress.md`) so a fresh session can resume.
- When stuck after 2 failed attempts at the same fix: stop, switch to `systematic-debugging`, and report findings rather than looping.
- End every task with: what changed, how it was verified (actual command output), anything left undone or risky.

## Keeping this file healthy
- Target <200 lines. Project-specific facts go in the project's `CLAUDE.md`; path-specific rules in `.claude/rules/` with `paths:` frontmatter; long procedures become skills.
- When I correct the same mistake twice, propose a one-line addition here.
