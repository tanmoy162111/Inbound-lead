import type { LeadRouter, RoutableLead } from "./router.js";

const BASE = "https://api.hubapi.com";

/** "Jane van Doe" -> firstname "Jane", lastname "van Doe". */
export function splitName(name: string | null): { firstname?: string; lastname?: string } {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (parts.length === 0) return {};
  if (parts.length === 1) return { firstname: parts[0] };
  return { firstname: parts[0], lastname: parts.slice(1).join(" ") };
}

export function toHubSpotProperties(lead: RoutableLead): Record<string, string> {
  const props: Record<string, string> = {
    email: lead.email,
    ...splitName(lead.name),
    ...(lead.phone ? { phone: lead.phone } : {}),
    ...(lead.company ? { company: lead.company } : {}),
    ...(lead.message ? { message: lead.message } : {}),
  };
  return props;
}

/**
 * Creates or updates a HubSpot contact keyed by email (private-app access token).
 * Search -> PATCH if found, else POST; a 409 (created concurrently) re-searches and patches.
 * Throws on any failure (including 429/5xx) so the outbox retries.
 */
export class HubSpotRouter implements LeadRouter {
  constructor(
    private readonly token: string,
    private readonly timeoutMs = 10_000,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly base = BASE,
  ) {}

  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    return this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  private async findIdByEmail(email: string): Promise<string | null> {
    const res = await this.call("POST", "/crm/v3/objects/contacts/search", {
      filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
      properties: ["email"],
      limit: 1,
    });
    if (!res.ok) throw new Error(`hubspot search responded ${res.status}`);
    const data = (await res.json()) as { results?: { id: string }[] };
    return data.results?.[0]?.id ?? null;
  }

  private async update(id: string, properties: Record<string, string>): Promise<void> {
    const res = await this.call("PATCH", `/crm/v3/objects/contacts/${id}`, { properties });
    if (!res.ok) throw new Error(`hubspot update responded ${res.status}`);
  }

  async route(lead: RoutableLead): Promise<void> {
    const properties = toHubSpotProperties(lead);
    const existing = await this.findIdByEmail(lead.email);
    if (existing) return this.update(existing, properties);

    const res = await this.call("POST", "/crm/v3/objects/contacts", { properties });
    if (res.ok) return;
    if (res.status === 409) {
      const id = await this.findIdByEmail(lead.email);
      if (id) return this.update(id, properties);
    }
    throw new Error(`hubspot create responded ${res.status}`);
  }
}
