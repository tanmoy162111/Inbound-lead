import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  WEBHOOK_SECRET: z.string().min(16, "WEBHOOK_SECRET must be at least 16 chars"),
  DESTINATION_URL: z.url().optional(),
  DESTINATION_TOKEN: z.string().min(1).optional(),
  HUBSPOT_ACCESS_TOKEN: z.string().min(1).optional(),
  METRICS_TOKEN: z.string().min(16).optional(),
  LEAD_RETENTION_MONTHS: z.coerce.number().int().positive().default(24),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
  RAW_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return schema.parse(source);
}
