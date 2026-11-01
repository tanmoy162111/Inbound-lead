# Runbook

## Deploy
1. CI green on the commit (lint, typecheck, test, build, audit).
2. Build the image: `docker build -t lead-intake:<git-sha> .` — tag by SHA, never overwrite a tag.
3. Run migrations as a separate step: `node dist/db/migrate.js` (image entrypoint override) against the target DB.
4. Roll out the new image; check `GET /healthz`, `GET /readyz`, then send one signed test lead.

## Migrations
Forward-only, applied once, never edited. Use expand → migrate → contract: ship additive changes first so the
previous image keeps working against the new schema; drop old columns only in a later release.

## Rollback
- **App:** redeploy the previous SHA-tagged image. Safe because migrations are backward-compatible (above).
- **Data:** no automatic down-migrations. A bad migration is fixed with a new forward migration or a restore from backup.
- **Stuck deliveries:** requeue dead letters:
  `UPDATE outbox SET status='pending', attempts=0, next_attempt_at=now() WHERE status='dead';`

## Alerts (via `GET /metrics`, requires `METRICS_TOKEN`)
- `lead_outbox_dead > 0` — deliveries are failing permanently; check `outbox.last_error`.
- `lead_outbox_oldest_pending_seconds > 900` — worker stalled or destination down.

## Not yet in place
Error tracking (e.g. Sentry), uptime check on `/healthz`, tested DB backup/restore, container image scan in CI.
