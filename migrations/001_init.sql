-- Raw payloads are persisted first, before any processing (replayable).
CREATE TABLE IF NOT EXISTS raw_events (
  id           BIGSERIAL PRIMARY KEY,
  source       TEXT        NOT NULL,
  payload      JSONB       NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
  id             BIGSERIAL PRIMARY KEY,
  raw_event_id   BIGINT      NOT NULL REFERENCES raw_events(id),
  idempotency_key TEXT       NOT NULL UNIQUE,
  source         TEXT        NOT NULL,
  email          TEXT        NOT NULL,
  name           TEXT,
  phone          TEXT,
  company        TEXT,
  message        TEXT,
  score          INTEGER     NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'new',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leads_email_idx ON leads (email);

-- Payloads that failed validation are quarantined with a reason, never dropped.
CREATE TABLE IF NOT EXISTS rejected_events (
  id           BIGSERIAL PRIMARY KEY,
  raw_event_id BIGINT NOT NULL REFERENCES raw_events(id),
  reason       TEXT   NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
