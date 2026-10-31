export interface RoutableLead {
  id: number;
  source: string;
  email: string;
  name: string | null;
  phone: string | null;
  company: string | null;
  message: string | null;
  score: number;
}

/** Must throw on failure so the outbox worker can retry. Must be safe to call twice for one lead. */
export interface LeadRouter {
  route(lead: RoutableLead): Promise<void>;
}

/** Default destination when none is configured: logs the lead id only (no PII). */
export class LogRouter implements LeadRouter {
  constructor(private readonly log: (obj: object, msg: string) => void) {}
  async route(lead: RoutableLead): Promise<void> {
    this.log({ leadId: lead.id, score: lead.score, source: lead.source }, "lead routed");
  }
}

/** POSTs the lead as JSON to any HTTP endpoint (CRM webhook, Zapier, n8n, Slack relay...). */
export class HttpRouter implements LeadRouter {
  constructor(
    private readonly url: string,
    private readonly token?: string,
    private readonly timeoutMs = 10_000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async route(lead: RoutableLead): Promise<void> {
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Lets the receiver dedupe if we retry after a timeout.
        "idempotency-key": `lead-${lead.id}`,
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify(lead),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`destination responded ${res.status}`);
  }
}
