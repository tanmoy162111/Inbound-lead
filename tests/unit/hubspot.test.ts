import { describe, expect, it, vi } from "vitest";
import { HubSpotRouter, splitName, toHubSpotProperties } from "../../src/adapters/hubspot.js";
import type { RoutableLead } from "../../src/adapters/router.js";

const lead: RoutableLead = {
  id: 1,
  source: "web",
  email: "jane@acme.com",
  name: "Jane van Doe",
  phone: "+15551234567",
  company: "Acme",
  message: "Hi",
  score: 80,
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const calls = (f: ReturnType<typeof vi.fn>) =>
  f.mock.calls.map(([u, i]) => `${(i as RequestInit).method} ${new URL(u as string).pathname}`);

describe("mapping", () => {
  it("splits names and omits empty fields", () => {
    expect(splitName("Jane van Doe")).toEqual({ firstname: "Jane", lastname: "van Doe" });
    expect(splitName("Cher")).toEqual({ firstname: "Cher" });
    expect(splitName(null)).toEqual({});
    expect(toHubSpotProperties({ ...lead, phone: null, company: null, message: null })).toEqual({
      email: "jane@acme.com",
      firstname: "Jane",
      lastname: "van Doe",
    });
  });
});

describe("HubSpotRouter", () => {
  it("creates when no contact matches", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json({ results: [] }))
      .mockResolvedValueOnce(json({ id: "9" }, 201));
    await new HubSpotRouter("tok", 1000, f).route(lead);
    expect(calls(f)).toEqual([
      "POST /crm/v3/objects/contacts/search",
      "POST /crm/v3/objects/contacts",
    ]);
    expect((f.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({
      authorization: "Bearer tok",
    });
  });
  it("updates when the contact exists", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json({ results: [{ id: "42" }] }))
      .mockResolvedValueOnce(json({}));
    await new HubSpotRouter("tok", 1000, f).route(lead);
    expect(calls(f)).toEqual([
      "POST /crm/v3/objects/contacts/search",
      "PATCH /crm/v3/objects/contacts/42",
    ]);
  });
  it("recovers from a 409 race by re-searching and patching", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json({ results: [] }))
      .mockResolvedValueOnce(json({}, 409))
      .mockResolvedValueOnce(json({ results: [{ id: "7" }] }))
      .mockResolvedValueOnce(json({}));
    await new HubSpotRouter("tok", 1000, f).route(lead);
    expect(calls(f).at(-1)).toBe("PATCH /crm/v3/objects/contacts/7");
  });
  it("throws on rate limit or server errors so the outbox retries", async () => {
    await expect(
      new HubSpotRouter("tok", 1000, vi.fn().mockResolvedValue(json({}, 429))).route(lead),
    ).rejects.toThrow("429");
    const f = vi
      .fn()
      .mockResolvedValueOnce(json({ results: [] }))
      .mockResolvedValueOnce(json({}, 500));
    await expect(new HubSpotRouter("tok", 1000, f).route(lead)).rejects.toThrow("500");
  });
});
