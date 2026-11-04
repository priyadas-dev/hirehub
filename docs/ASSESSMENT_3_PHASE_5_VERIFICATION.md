# HireHub Assessment 3 — Phase 5 Independent Verification

**Date:** 2026-11-02  
**Scope:** Phase 5 CRM only (read-only verification)  
**Sources:** `docs/ASSESSMENT_3_PHASE_5_REPORT.md`, `docs/ASSESSMENT_3_ENGINEERING_RULES.md`, source under `src/lib/crm`, `src/routes/_app.recruiter.crm*`, Phase 4 integrations, `PROPOSED_0020`/`0021`  
**Mutations:** None — no code, migrations, `.env`, database, or deployment changes in this verification.

**Verdict labels:** `PASS` | `FAIL` | `BLOCKED` | `MOCKED`

---

## Summary verdict

| # | Check | Verdict |
|---|---|---|
| 1 | CRM integrated into Recruiter workspace | **PASS** |
| 2 | CRM routes, navigation, authentication | **PASS** (code + unit); live browser session **BLOCKED** (not exercised) |
| 3 | Supabase queries ↔ proposed migrations consistent | **PASS** (static); live tables **BLOCKED** (unapplied) |
| 4 | Recruiter ownership + RLS protections | **PASS** (SQL + unit ownership); live RLS **BLOCKED**; store tests **MOCKED** |
| 5 | Resend/HubSpot use Phase 4 implementations | **PASS** with finding (shared Phase 4 layer; CRM-specific send wrappers) |
| 6 | Webhook tracking identifies campaign recipients | **PASS** (code + unit); live EF ingest **BLOCKED** |
| 7 | Existing HireHub workflows unaffected | **PASS** |

**Overall live CRM readiness:** **BLOCKED** until migrations are applied, secrets configured, and `resend-webhook` redeployed (see § Remaining before live).

---

## Check 1 — CRM in Recruiter workspace

**Verdict: PASS**

Evidence:
- Routes live under `_app.recruiter.*` pathless layout (`src/routes/_app.recruiter.crm*.tsx`).
- Recruiter sidebar includes `{ label: "CRM", to: "/recruiter/crm" }` in `src/components/shell/nav.ts`.
- `AppSidebar` treats `/recruiter/crm` and children as one active nav item.
- UI reuses HireHub shell patterns (`PageHeader`, `EmptyState`, `surface-card`, existing Button/Input/Select).
- No separate CRM product shell or redesign of the app chrome.

---

## Check 2 — Routes, navigation, authentication

**Verdict: PASS** (structural + unit) · **BLOCKED** (interactive live auth not run)

Evidence:
- `routeTree.gen.ts` registers `/recruiter/crm`, `/contacts`, `/segments`, `/campaigns`, `/campaigns/$campaignId`.
- Parent `/_app/recruiter` `beforeLoad` uses `wrongRoleHome(context.session.role, "recruiter")` — role from session/`profiles.role`, not browser claims.
- CRM pages use `useAuth()` for recruiter id; campaign detail also denies non-owner UI when `recruiterId !== user.id` (server still AuthZ on send).
- Unit: `src/test/app-routing.test.tsx` matches CRM paths (re-run this session: **pass**).

Not verified here:
- Signed-in browser click-through as recruiter/seeker/admin.
- Seekers redirected away from `/recruiter/crm` in a live session (implied by layout gate; not browser-tested).

---

## Check 3 — Supabase queries vs proposed migrations

**Verdict: PASS** (static consistency) · **BLOCKED** (tables not on live DB)

Evidence (column/table alignment):
| Code usage | `PROPOSED_0021` |
|---|---|
| `crm_contacts` + `email_normalized`, `skills`, `job_interests`, `segment_kind`, `hubspot_contact_id` | Present |
| `crm_segments` + `filter_json`, `kind` | Present |
| `crm_campaigns` + `html_body`, `send_idempotency_key`, status enum | Present |
| `crm_campaign_recipients` + tracking + send keys | Present |
| Unique `(recruiter_id, email_normalized)` | Matches duplicate handling in `createCrmContact` |
| Optional `email_delivery_events.campaign_recipient_id` | Added in 0021 DO block when 0020 table exists |

Findings (non-FAIL):
- Generated `Database` types do **not** include CRM tables — adapters use loose `from("crm_*")` (documented in Phase 5 report).
- `probeCrmSchemaReady` correctly treats missing relation as not ready and surfaces EmptyState.
- Drizzle and `supabase/migrations/20261102130000_proposed_0021_*` mirrors exist; **neither applied**.

---

## Check 4 — Recruiter ownership and RLS

**Verdict: PASS** (design + unit) · **BLOCKED** (live DB) · ownership suite partly **MOCKED**

Evidence:
- All CRM tables denormalize `recruiter_id`; policies use `recruiter_id = auth.uid() OR current_role_is('admin')` without cross-table `EXISTS` (avoids L3 recursion class).
- INSERT policies require `current_role_is('recruiter')` and `recruiter_id = auth.uid()`.
- Seekers have no CRM grants beyond authenticated owner policies (cannot match seeker’s uid to another recruiter’s rows).
- Server send (`send-campaign.server.ts`) and HubSpot soft-sync load campaign/contact then `canAccessCrmOwnedResource` before service-role writes.
- Unit: `src/test/crm-phase5.test.ts` — other recruiter denied list/send (**pass** this session).

MOCKED: in-memory CRM store mirrors ownership; does not execute Postgres RLS.

BLOCKED: cannot prove live RLS until `PROPOSED_0021` is applied and exercised with two recruiter JWTs.

---

## Check 5 — Resend / HubSpot use Phase 4 implementations

**Verdict: PASS** (with finding)

Evidence of Phase 4 reuse:
| Capability | Phase 4 artifact used by Phase 5 |
|---|---|
| Env names / readers | `@/lib/integrations/env` (`RESEND_*`, `HUBSPOT_*`) |
| HubSpot name split | `splitFullName` from `@/lib/integrations/hubspot-sync` |
| Resend errors | `classifyResendFailure` from `@/lib/resend-errors` |
| Inbound Svix webhook | `@/lib/integrations/resend-webhook` + `svix-verify` extended for CRM tags |
| Edge Function | `supabase/functions/resend-webhook` updated for `campaign_recipient_id` |

Finding (not FAIL against Track 2 intent):
- CRM does **not** call `sendApplicationStatusMail` or `syncApplicationToHubSpot` (application-status-shaped APIs).
- Instead it uses CRM-specific `sendCampaignEmailViaResend` and `syncCrmContactToHubSpot` that share the same Phase 4 env/provider layer and soft-fail pattern — appropriate for different tags/properties, but they **duplicate** the HubSpot PATCH/create HTTP flow rather than exporting a shared Phase 4 upsert helper.

Secrets remain server-only (createServerFn / EF); no `VITE_` CRM secrets found in CRM libs.

---

## Check 6 — Webhook tracking identifies campaign recipients

**Verdict: PASS** (handler + unit) · **BLOCKED** (live EF + DB)

Evidence:
- Outbound tags include `campaign_recipient_id` (`campaign-mail.ts`).
- `handleResendWebhookRequest` extracts tag/header → `campaignRecipientId` in 200 body; memory store tracks by recipient id.
- EF inserts `campaign_recipient_id` into `email_delivery_events` and, on non-duplicate events, updates `crm_campaign_recipients.tracking_status` / `opened_at` / `sent_at`.
- Unit: CRM webhook replay + opened tracking in `crm-phase5.test.ts`; Phase 4 signature/idempotency tests still green (**72** related tests pass this session including CRM + Phase 4 + routing + notify + apply).

BLOCKED live: EF must be redeployed with this code; `PROPOSED_0020`/`0021` must exist for durable event + recipient updates.

---

## Check 7 — Existing HireHub workflows unaffected

**Verdict: PASS**

Evidence:
- Applicants route still uses `updateApplicationStatusWithNotification`; no CRM rewrite of applicants.
- Notify path still delivers in-app notification first; Phase 4 soft integrations remain additive.
- Regression unit re-run this session: notify-application-status + idempotent-apply + app-routing + Phase 4 integrations + CRM — **all pass** (72 tests in that set).
- CRM is additive nav/routes; no removal of seeker/admin workflows observed in CRM files.

Not re-run this session: full `npm test` (531 previously reported in Phase 5 report) — spot set above covers CRM + critical regression surfaces.

---

## What remains before CRM can work live

Ordered blockers (nothing in this list was performed during verification):

1. **Explicit approval + apply** `PROPOSED_0020` (`email_delivery_events`), then `PROPOSED_0021` (CRM tables + optional `campaign_recipient_id` column). Reload PostgREST schema cache if required.
2. **Host secrets** (manual; never commit): `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (or `CONTACT_FROM_EMAIL`), `RESEND_WEBHOOK_SECRET`, `HUBSPOT_ACCESS_TOKEN` (optional for soft sync).
3. **Deploy** updated `supabase/functions/resend-webhook` and point Resend dashboard webhook at it.
4. **HubSpot portal** (optional): create custom properties used by CRM sync (`hirehub_crm_contact_id`, `hirehub_segment_kind`, etc.) or accept soft HTTP failures.
5. **Smoke demo** as a recruiter JWT: Contacts → Segments → Campaign → preview → confirm send → open event → tracking UI.
6. **Optional:** regenerate Supabase `Database` types after apply so CRM tables are typed.

Until step 1–3 complete, the UI correctly shows schema-pending EmptyState / soft-skips providers — code is present, **live CRM is BLOCKED**.

---

## Verification commands run (read-only)

```bash
npm test -- src/test/crm-phase5.test.ts src/test/integrations-phase4.test.ts src/test/app-routing.test.tsx src/test/notify-application-status.test.ts src/test/idempotent-apply.test.ts
```

Result this session: **5 files, 72 passed**.

---

## Next step

**STOP.** Phase 5 verification complete. Do not start Phase 6 until the user explicitly approves it. Live CRM enablement is a separate migration/secrets/deploy approval track, not Phase 6.
