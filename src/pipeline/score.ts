import type { NormalizedLead } from "./types.js";

const FREE_MAIL = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com"]);

/** Transparent rule-based score, 0-100. */
export function scoreLead(lead: NormalizedLead): number {
  let score = 10;
  const domain = lead.email.split("@")[1] ?? "";
  if (!FREE_MAIL.has(domain)) score += 30;
  if (lead.phone) score += 20;
  if (lead.company) score += 15;
  if (lead.name) score += 5;
  if (lead.message && lead.message.length >= 40) score += 20;
  return Math.min(score, 100);
}
