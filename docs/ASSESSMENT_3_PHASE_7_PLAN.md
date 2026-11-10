# Assessment 3 — Phase 7 Implementation Plan

**Approved:** user requested start Phase 7  
**Scope:** Application agent (confirm-to-apply) + Recruiter agent (owned shortlist / outreach draft)  
**Non-goals:** Phase 8, CRM email deploy, schema changes, service-role apply

## Reuse
- `applyToJob` + JWT adapter (UNIQUE + 23505)
- Phase 6 supervisor / memory / guardrails
- `isAuthorizedApplicationNotifier`, CRM `createCampaignRecord` / ownership

## New
| File | Role |
|---|---|
| `src/lib/ai/agents/application.ts` | Propose apply → require `confirm` → `applyToJob` |
| `src/lib/ai/agents/recruiter.ts` | Shortlist owned apps; draft CRM outreach (no silent send) |
| `src/lib/ai/ask-recruiter-agent.ts` | Recruiter-gated server fn |
| Confirm chip in seeker assistant | When `pendingApply` present |
| `src/test/phase7-agents.test.ts` | Unconfirmed=0 inserts; confirm+idempotent; non-owner deny |

## Acceptance
1. Confirm-to-apply path works (unit + structured result)  
2. Idempotency + resume path checks respected  
3. Recruiter tool denied for non-owned job  
