# Assessment 3 — Phase 6 Implementation Plan

**Status:** Approved to implement (user 2026-11-02)  
**Scope:** Guardrails + Supervisor + Discovery Agent only (no Phase 7)

## Reuse
- `runJobAssistant` / `askJobAssistant` / intent / live-recommend / corpus-retrieve / skill-match
- Seeker UI unchanged; supervisor wraps pipeline behind server fn

## New modules (`src/lib/ai/`)
| Path | Role |
|---|---|
| `guardrails/pii.ts` | Redact emails/phones/NID-like tokens from prompts before LLM/tools |
| `guardrails/fairness.ts` | Detect biased hiring filters; refuse or neutralize **before** rank |
| `guardrails/confidence.ts` | Low-confidence refusal when no grounded live/corpus context |
| `guardrails/validation.ts` | Structured I/O checks (question, role, result shape) |
| `memory/server-memory.ts` | In-process Map keyed by `userId` + `conversationId` (no DDL) |
| `agents/discovery.ts` | Live jobs + optional corpus; never invents vacancies |
| `agents/supervisor.ts` | Guardrails → route discovery/conversation → memory write |

## Risks
| Risk | Mitigation |
|---|---|
| Rebuild assistant UI | Wire only in `job-assistant` / `ask-job-assistant` |
| Invented jobs | Discovery returns only approved live / labeled synthetic corpus |
| Fairness after rank | Gate runs before `rankJobsBySkills` / recommend |
| DB migration | None — memory in-process until additive table approved |
| CRM/email | Out of scope |

## Acceptance (roadmap)
1. Supervisor → discovery path works  
2. Guardrails invoked  
3. Biased prompt test passes  
4. Shared memory readable across turns  

## Non-goals
Phase 7 agents, Resend/HubSpot, migration apply/repair, corpus reseed, `.env` edits, commit/push
