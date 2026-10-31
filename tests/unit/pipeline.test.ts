import { describe, expect, it } from "vitest";
import { idempotencyKey } from "../../src/pipeline/dedupe.js";
import { maskEmail, normalizeLead, normalizePhone } from "../../src/pipeline/normalize.js";
import { scoreLead } from "../../src/pipeline/score.js";
import { validateInbound } from "../../src/pipeline/validate.js";

describe("validateInbound", () => {
  it("accepts a minimal lead and nulls empty optionals", () => {
    const r = validateInbound({ source: "web", email: "a@b.com", name: "  " });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.name).toBeNull();
  });
  it("rejects malformed email with a reason", () => {
    const r = validateInbound({ source: "web", email: "nope" });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.reason).toContain("email");
  });
  it("rejects non-object payloads", () => {
    expect(validateInbound(null).ok).toBe(false);
    expect(validateInbound("x").ok).toBe(false);
  });
});

describe("normalize", () => {
  it("lowercases email and source", () => {
    const v = validateInbound({ source: " Web ", email: "Jane@Acme.COM" });
    if (!v.ok) throw new Error("invalid");
    expect(normalizeLead(v.value)).toMatchObject({ source: "web", email: "jane@acme.com" });
  });
  it("normalizes phones", () => {
    expect(normalizePhone("+44 (20) 7946-0958")).toBe("+442079460958");
    expect(normalizePhone("12")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
  it("masks emails", () => {
    expect(maskEmail("jane@acme.com")).toBe("j***@acme.com");
  });
});

describe("idempotencyKey", () => {
  it("is stable per source+email and differs across sources", () => {
    const a = idempotencyKey({ source: "web", email: "a@b.com" });
    expect(a).toBe(idempotencyKey({ source: "web", email: "a@b.com" }));
    expect(a).not.toBe(idempotencyKey({ source: "ads", email: "a@b.com" }));
  });
});

describe("scoreLead", () => {
  const base = {
    source: "web",
    email: "a@gmail.com",
    name: null,
    phone: null,
    company: null,
    message: null,
  };
  it("scores business leads higher than bare free-mail leads", () => {
    const rich = { ...base, email: "a@acme.com", phone: "+1555", company: "Acme", name: "A" };
    expect(scoreLead(rich)).toBeGreaterThan(scoreLead(base));
  });
  it("caps at 100", () => {
    const max = {
      ...base,
      email: "a@acme.com",
      phone: "1",
      company: "x",
      name: "n",
      message: "m".repeat(80),
    };
    expect(scoreLead(max)).toBeLessThanOrEqual(100);
  });
});
