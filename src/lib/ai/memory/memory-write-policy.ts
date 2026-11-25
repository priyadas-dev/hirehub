/**
 * A4 explicit write policy — what Supervisor may persist into durable memory.
 * Browser never writes these tables directly.
 */

export const MEMORY_WRITE_POLICY = {
  allowedSemanticKinds: [
    "target_role",
    "location",
    "skill",
    "preference",
    "recruiter_rubric",
    "summary_fact",
  ] as const,
  allowedEventTypes: [
    "user_turn",
    "assistant_turn",
    "fact_learned",
    "session_summary",
    "forget",
  ] as const,
  neverPersist: [
    "raw_pii",
    "passwords",
    "tokens",
    "api_keys",
    "full_resume_text",
    "payment_data",
  ] as const,
  maxSemanticContentChars: 500,
  maxEpisodicSummaryChars: 1000,
  recallTopK: 5,
  compactTurnThreshold: 12,
  keepTurnsAfterCompact: 6,
} as const;

export type SemanticMemoryKind = (typeof MEMORY_WRITE_POLICY.allowedSemanticKinds)[number];
export type EpisodicEventType = (typeof MEMORY_WRITE_POLICY.allowedEventTypes)[number];

export function isAllowedSemanticKind(kind: string): kind is SemanticMemoryKind {
  return (MEMORY_WRITE_POLICY.allowedSemanticKinds as readonly string[]).includes(kind);
}

export function isAllowedEventType(type: string): type is EpisodicEventType {
  return (MEMORY_WRITE_POLICY.allowedEventTypes as readonly string[]).includes(type);
}
