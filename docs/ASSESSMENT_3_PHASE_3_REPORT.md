# HireHub Assessment 3 — Phase 3 Report (Integration Contracts)

**Phase:** 3 only  
**Date:** 2026-11-02  
**Branch:** `feature/auth-module-phases-1-7`  
**Rules followed:** engineering rules, checklist, roadmap, baseline, Phase 1–2 reports, project-guardian  

**Mutation statement:** No vendor feature code, no `.env` edits, no migrations/RLS/live data changes, no HubSpot/Resend webhook implementation, no commit/push. Phase 4 not started.

---

## 1. Understanding

Finalize written contracts for Track 1 integrations and Track 2 CRM tracking **before** coding outbound APIs or webhooks.

---

## 2. Decision

| Approach | Chosen? | Why |
|---|---|---|
| Stop — vendors still ambiguous | No | Phase 3 approval proceeds with the documented recommended stack |
| Resend + Stripe as default | No | Weaker HireHub fit; kept as fallback only |
| **Resend + HubSpot + Resend Svix inbound; HireHub CRM SoT** | **Yes** | Matches brief examples, reuses existing Resend, enables campaign open tracking |

---

## 3. Implementation (docs only)

| File | Change |
|---|---|
| `docs/assessment-3-integration-contracts.md` | **Created** — full contracts |
| `docs/ASSESSMENT_3_PHASE_3_REPORT.md` | **Created** — this report |
| `docs/ASSESSMENT_3_ENGINEERING_RULES.md` | Pending approvals updated to record Phase 3 vendor/CRM baseline |

### Contract highlights
- Outbound: application-status email (Resend) + HubSpot contact sync  
- Inbound: Resend Svix-signed webhook; unsigned/invalid → **401**  
- Idempotency: outbound keys + inbound `svix-id` unique store (table designed, not migrated)  
- CRM SoT: HireHub tables; HubSpot sync ids optional  
- Tracking map: `sent` / `opened` / `replied` (manual v1) / `applied`  
- Env **names only** (`RESEND_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET`, `HUBSPOT_ACCESS_TOKEN`, …)  
- Cron shared secrets explicitly **not** Track 1 webhooks  

---

## 4. Protected areas

Application runtime code, `.env`, package.json, CI workflow content (unchanged this phase), migrations, RAG, agents, CRM UI — all untouched for feature work.

---

## 5. Verification

| Criterion | Status |
|---|---|
| Approved vendors named in writing | **Met** |
| Outbound + inbound + idempotency specified | **Met** |
| Unsigned rejection planned | **Met** (§6 test table in contracts) |
| Single CRM SoT stated | **Met** |
| No Phase 4 code / no `.env` edit | **Met** |
| Automated tests for webhook | **Deferred to Phase 4** (plan only — per roadmap) |

No `npm test` required for docs-only phase; suite not re-run this phase.

---

## 6. Risks / limitations

1. HubSpot free-tier property names may need adjustment at implement time — contract lists suggested custom properties.  
2. Resend domain limits may block arbitrary recipient mail until domain verified — contract requires graceful failure + keep in-app notify.  
3. `replied` is manual in v1 (no IMAP).  
4. Additive tables are **design only** until Phase 4/5 + migration approval.  
5. Engineering rules updated to reflect contract baseline; Phase 4 still needs explicit start approval.

---

## 7. Next step

**STOP.** Await approval before **Phase 4** (implement integrations + signed webhook per `docs/assessment-3-integration-contracts.md`).

Before Phase 4, you should manually add secret **names** in host/env when ready (values never committed):  
`RESEND_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET`, `HUBSPOT_ACCESS_TOKEN` (plus existing `RESEND_API_KEY`).
