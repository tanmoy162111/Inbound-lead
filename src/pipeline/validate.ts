import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v?.trim() ? v.trim() : null));

export const inboundSchema = z.object({
  source: z.string().min(1).max(64),
  email: z.email().max(254),
  name: optionalText(200),
  phone: optionalText(40),
  company: optionalText(200),
  message: optionalText(5000),
});

export type ValidatedInbound = z.infer<typeof inboundSchema>;

export type ValidationResult =
  | { ok: true; value: ValidatedInbound }
  | { ok: false; reason: string };

export function validateInbound(payload: unknown): ValidationResult {
  const parsed = inboundSchema.safeParse(payload);
  if (parsed.success) return { ok: true, value: parsed.data };
  const reason = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  return { ok: false, reason: reason.join("; ") };
}
