# Inbound Lead Intake

Signed webhook → durable raw store → validate → normalize → dedupe → score → outbox → CRM (HubSpot / HTTP / log).

```bash
pnpm install && cp .env.example .env   # fill DATABASE_URL, WEBHOOK_SECRET
pnpm migrate && pnpm dev               # http://localhost:3000/healthz
pnpm check                             # lint + typecheck + tests (set TEST_DATABASE_URL for integration tests)
docker build -t lead-intake .          # deploy: run `pnpm migrate:prod` as a release step, then start the image
```

Details: [CLAUDE.md](CLAUDE.md) · decisions: [docs/adr](docs/adr) · deploy/rollback: [docs/runbook.md](docs/runbook.md)
