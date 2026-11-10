import { z } from "zod";

/** Structured input validation for supervised turns (beyond zod parse at the edge). */
export const supervisedTurnInputSchema = z.object({
  question: z.string().trim().min(3).max(1500),
  role: z.enum(["seeker", "recruiter", "admin"]),
  userId: z.string().uuid().optional(),
  conversationId: z.string().trim().min(1).max(80).optional(),
});

export type SupervisedTurnInput = z.infer<typeof supervisedTurnInputSchema>;

export type ValidationResult =
  | { ok: true; data: SupervisedTurnInput }
  | { ok: false; message: string; issues: string[] };

export function validateSupervisedTurn(input: unknown): ValidationResult {
  const parsed = supervisedTurnInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Invalid assistant request.",
      issues: parsed.error.issues.map((i) => i.message),
    };
  }
  if (parsed.data.role !== "seeker") {
    return {
      ok: false,
      message: "The AI Job Assistant is only available in the job seeker workspace.",
      issues: ["role_not_seeker"],
    };
  }
  return { ok: true, data: parsed.data };
}

export type StructuredAssistantPayload = {
  answer: string;
  liveJobIds: string[];
  corpusKeys: Array<string | null>;
  guardrails: {
    fairness?: string;
    piiRedacted?: boolean;
    lowConfidence?: boolean;
    needsClarification?: boolean;
  };
};

export function buildStructuredAssistantPayload(input: StructuredAssistantPayload): StructuredAssistantPayload {
  return {
    answer: input.answer.trim(),
    liveJobIds: [...new Set(input.liveJobIds.filter(Boolean))],
    corpusKeys: input.corpusKeys.slice(0, 8),
    guardrails: { ...input.guardrails },
  };
}
