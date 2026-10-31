import type { NormalizedLead } from "./types.js";
import type { ValidatedInbound } from "./validate.js";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Best-effort E.164: keeps a leading "+", strips formatting. Returns null if implausible. */
export function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const plus = raw.trim().startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return plus ? `+${digits}` : digits;
}

export function normalizeLead(input: ValidatedInbound): NormalizedLead {
  return {
    source: input.source.trim().toLowerCase(),
    email: normalizeEmail(input.email),
    name: input.name,
    phone: normalizePhone(input.phone),
    company: input.company,
    message: input.message,
  };
}

export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}
