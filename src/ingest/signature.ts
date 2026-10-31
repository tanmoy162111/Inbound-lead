import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_TOLERANCE_SECONDS = 300;

/** Signs `${timestamp}.${body}` so a captured request cannot be replayed later. */
export function sign(secret: string, body: string, timestamp: number): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function signatureHeader(secret: string, body: string, timestamp: number): string {
  return `t=${timestamp},v1=${sign(secret, body, timestamp)}`;
}

/** Header format: `t=<unix seconds>,v1=<hex hmac>` (same scheme as Stripe webhooks). */
export function verifySignature(
  secret: string,
  body: string,
  header: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(nowSeconds - t) > SIGNATURE_TOLERANCE_SECONDS) return false;
  if (!/^[0-9a-f]{64}$/i.test(parts.v1 ?? "")) return false;
  const expected = Buffer.from(sign(secret, body, t), "hex");
  const given = Buffer.from(parts.v1 as string, "hex");
  return timingSafeEqual(given, expected);
}
