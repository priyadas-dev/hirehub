# HireHub Assessment 3 — Phase 7 Report

**Phase:** 7 — Application agent + Recruiter agent  
**Date:** 2026-11-03  
**Approval:** User requested start Phase 7  
**Binding docs:** roadmap, engineering rules, Phase 6 report, Phase 7 plan  

**Mutation statement:** No `.env` edits, no migration apply/repair/`db push`, no schema changes, no service-role apply, no silent campaign send, no Phase 8, no commit/push.

---

## 1. Understanding

Add real tool-taking specialists on top of Phase 6 supervision: confirm-to-apply for seekers (JWT + Phase 1 `applyToJob`), and recruiter shortlist / outreach draft under job + CRM ownership — without silent apply or send.

---

## 2. Decision

| Approach | Chosen? | Why |
|---|---|---|
| Service-role apply from agent | No | RLS + JWT only; Phase 1 helper |
| Auto-apply without UI confirm | No | Brief + roadmap forbid |
| Rebuild seeker assistant UI | No | Add confirm chip only |
| Recruiter silent email send | No | Draft + optional `confirmSend` via CRM prepare |
| **Application + recruiter agents + supervisor route + recruiter server fn** | **Yes** | Matches Phase 7 plan |

---

## 3. Implementation

### New modules
| Path | Role |
|---|---|
| `src/lib/ai/agents/application.ts` | Propose apply → require `confirm` → `applyToJob`; `insertsAttempted` |
| `src/lib/ai/agents/recruiter.ts` | `planRecruiterShortlist`, `draftRecruiterOutreach`, handoff errors |
| `src/lib/ai/ask-recruiter-agent.ts` | Recruiter/admin-gated server fn; ownership from JWT + DB |
| `src/test/phase7-agents.test.ts` | Confirm gate, idempotency, resume ACL, non-owner deny |
| `docs/ASSESSMENT_3_PHASE_7_PLAN.md` | Implementation plan |

### Evolved
| Path | Change |
|---|---|
| `src/lib/ai/agents/supervisor.ts` | Route apply intent → application agent |
| `src/lib/ai/ask-job-assistant.ts` | Wire `runApplicationAgent` with JWT apply client + resume ACL |
| `src/lib/ai/job-assistant.ts` | `applyJobId` / `confirmApply` input; `pendingApply` / `applyOutcome` |
| `src/lib/ai/assistant-live-store.ts` | Pass confirm fields through live ask |
| `src/routes/_app.seeker.assistant.tsx` | Confirm-apply chip + link to application |

### Flow
```text
Seeker UI → askJobAssistant (JWT + profiles.role)
  → runSupervisor
       → apply intent / applyJobId / confirmApply
            → runApplicationAgent
                 confirm=false → pendingApply (0 inserts)
                 confirm=true  → applyToJob (UNIQUE + 23505)

Recruiter → askRecruiterAgent
  → planRecruiterShortlist | draftRecruiterOutreach
       → ownership from job.recruiter_id / CRM rows (never body identity)
```

---

## 4. Acceptance criteria

| Criterion | Result | Evidence |
|---|---|---|
| Confirm-to-apply path | **PASS** | Unconfirmed → `needs_confirm` + `insertsAttempted: 0`; UI chip |
| Idempotency + resume ACL | **PASS** | Duplicate → `already_applied`; bad storage path → validation, 0 inserts |
| Recruiter tool denied for non-owned job | **PASS** | Shortlist + outreach `forbidden` for non-owner |

**Definition of Done:** Met for code/unit evidence. Live browser E2E of confirm chip **UNVERIFIED** this session (unit + wiring complete).

---

## 5. Tests

```text
vitest: phase7-agents.test.ts → 10 passed
```

Coverage:
- Unconfirmed apply → zero inserts  
- Confirmed apply → one row; duplicate safe  
- Resume path outside seeker folder rejected  
- Supervisor returns `pendingApply` when unconfirmed  
- Recruiter shortlist/outreach denied for non-owned job  
- Owner shortlist needs confirm; outreach draft without silent send  

---

## 6. Agent task scenarios (draft for Phase 8 eval)

1. **Apply needs confirm** — seeker says “apply to the first job” after discovery cards → `pendingApply`; no row until confirm.  
2. **Confirm apply** — seeker confirms → one `applications` row; retry → `already_applied`.  
3. **Resume ACL** — profile storage path under another user → validation error, no insert.  
4. **Recruiter non-owner** — shortlist/draft on another recruiter’s job → `forbidden`.  
5. **Recruiter owned draft** — outreach campaign record + preview; no send unless `confirmSend`.

---

## 7. Risks / limitations / gaps

1. Confirm-apply UI is seeker-assistant only (not job detail page).  
2. Recruiter agent is server-fn ready; dedicated recruiter chat UI not added.  
3. Live browser demo of confirm chip **UNVERIFIED**.  
4. Phase 8 RAG scale/eval not started.

---

## 8. Changed files (summary)

**Added:** `agents/application.ts`, `agents/recruiter.ts`, `ask-recruiter-agent.ts`, `phase7-agents.test.ts`, `PHASE_7_PLAN.md`, `PHASE_7_REPORT.md`  

**Modified:** `supervisor.ts`, `ask-job-assistant.ts`, `job-assistant.ts`, `assistant-live-store.ts`, `_app.seeker.assistant.tsx`, `IMPLEMENTATION_ROADMAP.md`

---

## 9. Next step

**STOP.** Phase 7 complete for approved scope.  
Await explicit approval before **Phase 8** (RAG Stages A→F + eval harness).
