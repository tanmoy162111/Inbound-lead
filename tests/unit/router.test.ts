import { describe, expect, it, vi } from "vitest";
import { HttpRouter, type RoutableLead } from "../../src/adapters/router.js";
import { backoffSeconds } from "../../src/ingest/outbox.js";

const lead: RoutableLead = {
  id: 7,
  source: "web",
  email: "a@b.com",
  name: null,
  phone: null,
  company: null,
  message: null,
  score: 40,
};

describe("HttpRouter", () => {
  it("posts JSON with idempotency key and bearer token", async () => {
    const f = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    await new HttpRouter("http://x.test/hook", "tok", 1000, f).route(lead);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://x.test/hook");
    expect(init.headers).toMatchObject({
      "idempotency-key": "lead-7",
      authorization: "Bearer tok",
    });
  });
  it("throws on non-2xx so the outbox retries", async () => {
    const f = vi.fn().mockResolvedValue(new Response("no", { status: 503 }));
    await expect(new HttpRouter("http://x.test", undefined, 1000, f).route(lead)).rejects.toThrow(
      "503",
    );
  });
});

describe("backoffSeconds", () => {
  it("grows exponentially, is jittered, and is capped", () => {
    const top = { random: () => 1 };
    expect(backoffSeconds(0, top)).toBe(5);
    expect(backoffSeconds(3, top)).toBe(40);
    expect(backoffSeconds(30, top)).toBe(3600);
    expect(backoffSeconds(3, { random: () => 0 })).toBe(20);
  });
});
