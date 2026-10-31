import { describe, expect, it } from "vitest";
import { signatureHeader, verifySignature } from "../../src/ingest/signature.js";

const secret = "s".repeat(32);
const now = 1_800_000_000;

describe("verifySignature", () => {
  const body = '{"a":1}';
  it("accepts a fresh valid signature", () => {
    expect(verifySignature(secret, body, signatureHeader(secret, body, now), now)).toBe(true);
  });
  it("rejects a tampered body, wrong secret, and missing header", () => {
    const h = signatureHeader(secret, body, now);
    expect(verifySignature(secret, '{"a":2}', h, now)).toBe(false);
    expect(verifySignature("x".repeat(32), body, h, now)).toBe(false);
    expect(verifySignature(secret, body, undefined, now)).toBe(false);
  });
  it("rejects stale and future timestamps", () => {
    expect(verifySignature(secret, body, signatureHeader(secret, body, now - 301), now)).toBe(
      false,
    );
    expect(verifySignature(secret, body, signatureHeader(secret, body, now + 301), now)).toBe(
      false,
    );
  });
  it("rejects malformed headers without throwing", () => {
    for (const h of ["", "garbage", "t=abc,v1=zz", `t=${now}`, `t=${now},v1=abcd`]) {
      expect(verifySignature(secret, body, h, now)).toBe(false);
    }
  });
});
