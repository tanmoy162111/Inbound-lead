-- Transactional outbox: a lead and its delivery job are written atomically,
-- so a crash or destination outage can never lose a routed lead.
CREATE TABLE IF NOT EXISTS outbox (
  id              BIGSERIAL PRIMARY KEY,
  lead_id         BIGINT      NOT NULL REFERENCES leads(id),
  status          TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','dead')),
  attempts        INTEGER     NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS outbox_lead_idx ON outbox (lead_id);
CREATE INDEX IF NOT EXISTS outbox_due_idx ON outbox (next_attempt_at) WHERE status = 'pending';
