import { createHash } from "node:crypto";
import type { NormalizedLead } from "./types.js";

/** Same source + email => same lead. Retries and duplicate webhooks collapse to one row. */
export function idempotencyKey(lead: Pick<NormalizedLead, "source" | "email">): string {
  return createHash("sha256").update(`${lead.source}\n${lead.email}`).digest("hex");
}
