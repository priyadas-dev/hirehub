# HireHub Assessment 3 — Phase 4 Report (Integrations + Signed Webhook)

**Phase:** 4 only  
**Date:** 2026-11-02  
**Branch:** `feature/auth-module-phases-1-7`  
**Rules followed:** engineering rules, checklist, roadmap, baseline, Phase 1–3 reports, integration contracts, project-guardian  

**Mutation statement:** No `.env` edits, no migration apply/`db push`, no RLS weaken on existing tables, no RAG mutate, no commit/push. `PROPOSED_0020` is design-only on disk. Phase 5 not started.

---

## 1. Understanding

Phase 4 must deliver Track 1: ≥2 real services, one outbound product path, one inbound signature-verified webhook with idempotent replay — without replacing in-app notify or weakening auth/RLS.

---

## 2. Decision

| Approach | Chosen? | Why |
|---|---|---|
| Replace in-app notify with email-only | No | Contracts require additive email; soft-fail if provider fails |
| TanStack-only webhook route | No | Prefer EF alongside existing `notify-application-status` / cron EFs |
| Apply `email_delivery_events` immediately | No | Additive DDL needs separate apply approval |
| **Resend status mail + HubSpot sync + Svix `resend-webhook` + memory/PROPOSED store; soft createServerFn after notify** | **Yes** | Matches Phase 3 contracts; secrets stay server-only; notify path stays authoritative |

**Untouched on purpose:** `.env`, applied migrations/RLS of applications/notifications, RAG/classifier, CRM UI (Phase 5), commit/push.

---

## 3. Implementation

### New files
| File | Purpose |
|---|---|
| `src/lib/integrations/env.ts` | Server-only env name constants (`RESEND_*`, `HUBSPOT_*`) |
| `src/lib/integrations/svix-verify.ts` | Svix header parse + HMAC verify + skew window |
| `src/lib/integrations/email-delivery-store.ts` | Memory store + tracking map helpers |
| `src/lib/integrations/resend-webhook.ts` | Pure webhook handler (401 unsigned/invalid; 200 idempotent) |
| `src/lib/integrations/application-status-mail.ts` | Resend outbound + process-local idempotency |
| `src/lib/integrations/hubspot-sync.ts` | HubSpot contact upsert by email |
| `src/lib/integrations/deliver-application-integrations.ts` | Orchestrator (email then HubSpot) |
| `src/lib/integrations/deliver-application-integrations.server.ts` | AuthZ createServerFn; service role for seeker email **after** JWT ownership check |
| `supabase/functions/resend-webhook/index.ts` | Deployable EF; rejects cron secret; Svix-only auth |
| `drizzle/migrations/PROPOSED_0020_email_delivery_events.sql` | Additive table + admin SELECT RLS (**unapplied**) |
| `supabase/migrations/20261102120000_proposed_0020_email_delivery_events.sql` | Mirror (**unapplied**) |
| `src/test/integrations-phase4.test.ts` | Signature / replay / outbound unit coverage |
| `docs/ASSESSMENT_3_PHASE_4_REPORT.md` | This report |

### Modified files
| File | Change |
|---|---|
| `src/lib/notify-application-status.ts` | After successful in-app notify, soft-call integrations runner (never throws to UI) |
| `src/test/notify-application-status.test.ts` | Stub integrations runner so in-app tests stay isolated |
| `docs/ASSESSMENT_3_ENGINEERING_RULES.md` | Record Phase 4 landed; `PROPOSED_0020` apply still pending |
| `docs/assessment-3-integration-contracts.md` | Status → Phase 4 implemented |

---

## 4. Protected areas

- `.env` / secret values (not edited; names documented only)  
- Existing applications/notifications RLS and notify EF delivery semantics  
- No HubSpot as competing CRM SoT  
- No Phase 5 CRM tables/UI  
- No commit/push  

---

## 5. Verification

| Check | Result |
|---|---|
| `npm test` (full suite) | **518 passed** / 66 files |
| `src/test/integrations-phase4.test.ts` | Unsigned/invalid → 401; replay idempotent; outbound mocks |
| `src/test/notify-application-status.test.ts` | Still green with soft-wire stub |
| `.env` modified? | **No** (git status) |
| Migration applied? | **No** — `PROPOSED_0020` on disk only |
| Production build this phase | Not required for Track 1 unit proof; deferred |

### Acceptance criteria (roadmap)
- [x] ≥2 external services in product paths (Resend + HubSpot libs wired after notify)  
- [x] One outbound path (application-status mail)  
- [x] One inbound signed webhook (`handleResendWebhookRequest` + EF)  
- [x] Unsigned rejected (tests)  

---

## 6. Risks / limitations

1. Live Resend/HubSpot demos need host secrets + domain verification; without keys, paths soft-skip (`provider_not_configured`).  
2. `email_delivery_events` must be **applied** (and EF deployed with `RESEND_WEBHOOK_SECRET`) before durable webhook persistence; until then EF still returns 200 after valid Svix verify.  
3. HubSpot custom properties may need portal setup; HTTP failures soft-fail.  
4. Process-local outbound idempotency is not cross-instance; Phase 5/DB store should harden this.  
5. Edge Function not deployed in this phase (code only).

---

## 7. Next step

**STOP.** Await approval before **Phase 5** (thin CRM: segments, campaigns, tracking UI).

Manual (when ready, outside Agent apply):
1. Add secrets locally/host: `RESEND_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET`, `HUBSPOT_ACCESS_TOKEN` (plus existing `RESEND_API_KEY`).  
2. Explicitly approve apply of `PROPOSED_0020` + deploy `resend-webhook`.  
3. Point Resend dashboard webhook at the EF URL.
