# HireHub Assessment 3 — Phase 5 CRM Live Setup & Verification Plan

**Status:** Documentation only (READ-ONLY preparation)  
**Date:** 2026-11-02  
**Authority:** Engineering rules, Phase 5 report/verification, integration contracts, migration-history reconciliation  
**Mutations in this document’s production:** None. This file does not authorize live changes by itself.

**Do not** treat this checklist as approval to apply migrations, deploy Edge Functions, edit `.env`, or start Phase 6. Each live action below needs **your explicit approval** when you are ready.

---

## Legend — evidence states

| Label | Meaning |
|---|---|
| **VERIFIED** | Confirmed by static inspection and/or prior unit tests (code/docs on disk) |
| **UNVERIFIED** | Plausible / prepared but not proven against live Supabase/Resend/HubSpot |
| **BLOCKED** | Cannot succeed until a prior approval/apply/deploy/secret step is done |

---

## 1. Migration safety findings

### Files inspected

| Lane | Phase 4 webhook store | Phase 5 CRM |
|---|---|---|
| Drizzle (canonical commentary) | `drizzle/migrations/PROPOSED_0020_email_delivery_events.sql` | `drizzle/migrations/PROPOSED_0021_crm_tables.sql` |
| Supabase CLI mirror | `supabase/migrations/20261102120000_proposed_0020_email_delivery_events.sql` | `supabase/migrations/20261102130000_proposed_0021_crm_tables.sql` |

### Safety assessment (static)

| Criterion | `PROPOSED_0020` | `PROPOSED_0021` | Notes |
|---|---|---|---|
| Additive only | **VERIFIED** | **VERIFIED** | `CREATE TABLE IF NOT EXISTS`; no `DROP TABLE` of existing HireHub cores |
| Does not alter applications/jobs/profiles RLS | **VERIFIED** | **VERIFIED** | New tables only; 0021 optionally `ADD COLUMN` on `email_delivery_events` |
| Compatible with `profiles` / `companies` | **VERIFIED** | **VERIFIED** | Soft `application_id` (no FK); CRM FKs to `profiles`/`companies` |
| Uses existing `current_role_is` | **VERIFIED** | **VERIFIED** | Present since core schema (`0000`) |
| Avoids cross-table RLS EXISTS recursion (L3) | N/A (admin SELECT only) | **VERIFIED** | Denormalized `recruiter_id` on every CRM row |
| Authenticated cannot forge webhook rows | **VERIFIED** | — | No INSERT grant/policy on `email_delivery_events` for authenticated |
| Recruiter ownership on CRM | — | **VERIFIED** (SQL text) | SELECT/UPDATE/DELETE owner or admin; INSERT requires recruiter + own `recruiter_id` |
| Idempotency keys | **VERIFIED** | **VERIFIED** | Unique `event_id`; unique campaign/recipient `send_idempotency_key` |
| Safe if 0020 applied after 0021 | Partial | **VERIFIED** | 0021 DO-block adds `campaign_recipient_id` only if `email_delivery_events` exists; **preferred order is still 0020 → 0021** |

### Risks / caveats (not FAIL of SQL design)

1. **History desync risk (L4):** Project previously had local↔remote migration history mismatch (`docs/supabase-migration-history-reconciliation.md`, 2026-10-29). Blind `supabase db push` remains **dangerous** and is **forbidden** without a separate history-sync approval.
2. **0019 still pending** (`claim_oauth_recruiter_role`) — orthogonal to CRM; do **not** bundle with 0020/0021 unless you explicitly approve 0019 in the same change window.
3. **0018** FTS effects may already be live with history gaps — do **not** re-run 0018 DDL as part of CRM go-live.
4. Live RLS enforcement for CRM is **BLOCKED** until 0021 is applied and tested with two recruiter JWTs (Phase 5 verification).
5. PostgREST schema cache may need a refresh after apply before the CRM UI probe succeeds (**UNVERIFIED** until apply).

**Static conclusion:** Both migrations are **safe to propose** as additive DDL for CRM live enablement, provided they are applied **manually in order** (SQL Editor or explicitly scoped apply), **not** via blind push/repair.

---

## 2. Migration order and prerequisites

### Required order

```text
1) PROPOSED_0020  — email_delivery_events (+ admin SELECT RLS)
2) PROPOSED_0021  — crm_* tables + RLS
                 — then ADD COLUMN campaign_recipient_id on email_delivery_events (idempotent)
3) Reload / wait for PostgREST schema awareness
4) Deploy resend-webhook EF (code already in repo)
5) Configure Resend webhook URL + secrets
6) Manual CRM smoke checklist (§6)
```

### Prerequisites (must already be true on live DB)

| Prerequisite | Status |
|---|---|
| `public.profiles`, `public.companies`, `public.user_role`, `public.current_role_is` | **VERIFIED** as core HireHub (assumed live from prior app use); re-confirm after apply with Dashboard |
| Existing applications/jobs RLS left alone | **VERIFIED** by SQL inspection |
| Phase 5 application code on the deployed app branch | **UNVERIFIED** for production host (code exists locally) |
| Explicit user approval to apply 0020 and 0021 | **BLOCKED** until you say so |

### Recommended apply method (when approved)

**Preferred:** Supabase Dashboard → SQL Editor → paste **exact** contents of:

1. `drizzle/migrations/PROPOSED_0020_email_delivery_events.sql`  
2. `drizzle/migrations/PROPOSED_0021_crm_tables.sql`  

Then **register** versions in `schema_migrations` only if your project’s history workflow requires it — using the local version IDs:

- `20261102120000` (0020)  
- `20261102130000` (0021)  

**Avoid unless separately planned:** `supabase db push`, mass `migration repair`, `db reset`.

### After-apply smoke SQL (manual, when approved — do not run now)

Use read-only checks first, e.g. confirm tables exist:

- `email_delivery_events`
- `crm_contacts`, `crm_segments`, `crm_campaigns`, `crm_campaign_recipients`
- column `email_delivery_events.campaign_recipient_id`

(Do not paste secrets into SQL.)

---

## 3. Local vs remote migration history

### Local disk (this repo) — **VERIFIED**

Present under `supabase/migrations/`:

- Remote baseline markers `20261011113947` … `20261011114010`
- Remote proposed patch markers `20261013190913` … `20261013191044`
- Proposed 0006–0016 (`20261014090001`–`010`)
- `20261023143604` (0017 pointer)
- `20261029120000` (0019 — historically **not** applied remotely as of 2026-10-29 diagnosis)
- **`20261102120000` (0020)** — local only, CRM go-live
- **`20261102130000` (0021)** — local only, CRM go-live

Drizzle also holds `PROPOSED_0020` / `PROPOSED_0021` and older PROPOSED_* sources.

### Remote history — **UNVERIFIED** as of this document date

This preparation did **not** call `supabase migration list --linked` or query live `schema_migrations` (read-only plan; no live CLI against production required for the doc).

Prior diagnosis (2026-10-29) established:

| Item | Prior finding |
|---|---|
| History desync both directions | Yes |
| 0019 remote | Missing; RPC missing |
| 0017 effects | Likely live |
| 0020 / 0021 | Did not exist yet → treat as **not remote** |

**Before any apply:** re-check Dashboard migration list / `schema_migrations` and confirm `email_delivery_events` / `crm_*` are absent. That re-check is **UNVERIFIED** until you (or an approved read-only probe) run it.

### Conflicts / missing migrations relevant to CRM

| Issue | Impact on CRM live setup |
|---|---|
| 0020/0021 not applied | **BLOCKED** — CRM UI EmptyState / no persistence |
| Blind `db push` with unsynced history | Risk of re-applying unrelated DDL — **do not** |
| 0019 pending | Unrelated OAuth claim gap — keep **separate** from CRM approval |
| 0018 history gap | Do not re-execute FTS DDL for CRM |

---

## 4. Environment variable names only

**Never put values in git, chat logs, or this doc.** Set values manually in local server `.env` and/or Supabase Edge Function secrets / host secret store.

### Required for campaign send (app server / TanStack createServerFn)

| Name | Role |
|---|---|
| `RESEND_API_KEY` | Resend API auth |
| `RESEND_FROM_EMAIL` | Preferred From for CRM + status mail |
| `CONTACT_FROM_EMAIL` | Fallback From if `RESEND_FROM_EMAIL` empty |
| `SUPABASE_URL` | Server Supabase URL |
| `SUPABASE_PUBLISHABLE_KEY` | JWT Auth middleware |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only after AuthZ (send/sync); **never `VITE_`** |

### Required for inbound webhook (Edge Function secrets)

| Name | Role |
|---|---|
| `RESEND_WEBHOOK_SECRET` | Svix signing secret from Resend webhook endpoint |
| `SUPABASE_URL` | Usually provided to EFs by platform |
| `SUPABASE_SERVICE_ROLE_KEY` | Usually provided to EFs by platform; used to insert events / update recipients |

### Optional (soft-fail if missing)

| Name | Role |
|---|---|
| `HUBSPOT_ACCESS_TOKEN` | Outbound CRM/contact sync |
| `HUBSPOT_CLIENT_SECRET` | Not required for v1 outbound-only |
| `CONTACT_TO_EMAIL` | Contact form only — not CRM send |

### Explicitly forbidden

- Any `VITE_RESEND_*`, `VITE_HUBSPOT_*`, or `VITE_` service-role keys  
- Committing real secret values  
- Using cron secret (`CRON_SECRET` / `x-hirehub-cron-secret`) as webhook auth  

`.env.example` currently documents `RESEND_API_KEY` and `CONTACT_FROM_EMAIL` among others; CRM also needs the **names** `RESEND_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET`, `HUBSPOT_ACCESS_TOKEN` added by you manually when ready (do **not** ask the agent to edit `.env`).

---

## 5. Safe `resend-webhook` Edge Function deployment instructions

**Source (repo):** `supabase/functions/resend-webhook/index.ts`  
**Status:** Code **VERIFIED** on disk; live deploy **BLOCKED** until you approve and run deploy yourself.

### Pre-deploy checklist

1. `PROPOSED_0020` applied (durable event store).  
2. `PROPOSED_0021` applied (so recipient updates succeed).  
3. Edge Function secret `RESEND_WEBHOOK_SECRET` set (Dashboard → Edge Functions → Secrets).  
4. Confirm platform injects `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` for functions.  
5. Do **not** configure cron shared secret as webhook auth.

### Deploy steps (manual — do not run in Agent without approval)

```text
1. Open Supabase Dashboard → Edge Functions
2. Create or update function name: resend-webhook
3. Deploy from repo path supabase/functions/resend-webhook
   (CLI example when YOU approve: npx supabase functions deploy resend-webhook --project-ref <PROJECT_REF>)
4. Set secret RESEND_WEBHOOK_SECRET to the Svix secret shown in Resend → Webhooks
5. Copy the function HTTPS URL
6. In Resend Dashboard → Webhooks:
   - Endpoint = that URL
   - Events at least: email.sent, email.delivered, email.opened, email.bounced, email.complained
7. Send a Resend test / wait for first CRM campaign open and confirm 200 responses
```

### Post-deploy sanity (manual)

| Check | Expected |
|---|---|
| POST without Svix headers | 401 |
| POST with `x-hirehub-cron-secret` only | 401 (cron rejected) |
| Valid signed event | 200; row in `email_delivery_events` when 0020 live |
| Replay same `svix-id` | 200 `duplicate: true`; no duplicate side effects |
| CRM open event with `campaign_recipient_id` tag | Recipient `tracking_status` → `opened` when 0021 live |

---

## 6. Live CRM verification checklist (manual)

Perform only after migrations + secrets + EF are live. Use a **test recruiter** account and a **recipient mailbox you control** (Resend free-tier often restricts arbitrary recipients).

### 6.1 Recruiter login and CRM access

| Step | Action | Pass criteria | State until live |
|---|---|---|---|
| A1 | Sign in as recruiter | Lands in recruiter workspace | **UNVERIFIED** live |
| A2 | Open sidebar **CRM** → `/recruiter/crm` | Overview loads (not schema EmptyState) | **BLOCKED** until 0021 |
| A3 | Sign in as seeker; open `/recruiter/crm` | Redirected away via role gate | **UNVERIFIED** live |
| A4 | Second recruiter cannot open first’s campaign URL | Access denied / empty | **BLOCKED** until 0021 + two accounts |

### 6.2 Contacts

| Step | Action | Pass criteria |
|---|---|---|
| B1 | Create contact with email, skills, segment kind | Appears in list |
| B2 | Create same email again | Duplicate handled (no second unique row) |
| B3 | Search/filter by query | Matching rows only |
| B4 | Optional: Import from applicants | Imports/skips without crashing |

### 6.3 Segments and campaigns

| Step | Action | Pass criteria |
|---|---|---|
| C1 | Create segment `new|active|placed` with skill/status filters | Saved; audience count sensible |
| C2 | Create campaign draft linked to segment | Appears in campaigns list |
| C3 | Edit subject + HTML; Save draft | Persists; preview shows content |
| C4 | Preview blockers when subject/body/segment missing | Send disabled / blockers shown |

### 6.4 Send test campaign

| Step | Action | Pass criteria |
|---|---|---|
| D1 | Without confirm checkbox | Cannot send |
| D2 | With confirm + Resend configured | Send succeeds or soft-skips with clear skip reason |
| D3 | Recipients created | Rows with `pending`→`sent` (or skip) |
| D4 | Confirm send again | Idempotent — `alreadySent` / no duplicate Resend blast |

### 6.5 Resend delivery + webhook tracking

| Step | Action | Pass criteria |
|---|---|---|
| E1 | Message arrives (or Resend dashboard shows sent) | Provider accepts mail |
| E2 | Open email (tracking pixel) | Webhook 200; `email_delivery_events` row |
| E3 | Campaign UI tracking | Recipient shows `opened` (or `sent`/`delivered`) |
| E4 | Replay webhook (Resend retry) | Duplicate ignored |

### 6.6 HubSpot synchronization

| Step | Action | Pass criteria |
|---|---|---|
| F1 | `HUBSPOT_ACCESS_TOKEN` unset | CRM still works; sync soft-skipped |
| F2 | Token set + properties exist | Contact gets `hubspot_contact_id` or sync ok flags |
| F3 | Token invalid | HireHub CRM rows remain; soft failure reason stored — **no crash** |

### 6.7 Cross-recruiter isolation / RLS

| Step | Action | Pass criteria |
|---|---|---|
| G1 | Recruiter B lists contacts | Does not see Recruiter A rows |
| G2 | Recruiter B calls send on A’s campaign id | Server rejects unauthorized |
| G3 | Direct PostgREST select as B on A’s `crm_campaigns` id | Empty / RLS deny |

### 6.8 Idempotency / duplicate-send prevention

| Step | Action | Pass criteria |
|---|---|---|
| H1 | Contact unique `(recruiter_id, email_normalized)` | Second insert collapses |
| H2 | Campaign `send_idempotency_key` | Second confirm does not re-mail all |
| H3 | Recipient `send_idempotency_key` | Per-recipient uniqueness |
| H4 | Webhook `event_id` unique | Replay safe |

---

## 7. Risks, blockers, rollback

### Blockers (must clear before “CRM live” claim)

1. Explicit approval to apply **0020** then **0021**.  
2. Secrets set (names in §4) — values never committed.  
3. `resend-webhook` deployed + Resend endpoint configured.  
4. App host running Phase 5 CRM routes.  
5. Recipient allowed by Resend plan/domain.  

### Operational risks

| Risk | Mitigation |
|---|---|
| History desync / accidental re-apply | Prefer SQL Editor; avoid blind `db push` |
| Resend testing recipient restriction | Use verified From + own inbox; soft-fail already coded |
| HubSpot custom props missing | Soft-fail; create props or ignore sync |
| EF without 0020/0021 | Verify still 200 after Svix; durable store/recipient update incomplete |
| Service role misuse | Keep AuthZ-before-admin pattern; never expose key to browser |

### Rollback considerations (if something goes wrong after apply)

**Preferred rollback (data-preserving):** disable Resend webhook endpoint; remove CRM nav usage; leave tables in place (empty or quarantine).  

**Hard rollback (destructive — needs separate explicit approval):** `DROP TABLE` CRM tables / `email_delivery_events` — **do not** do this lightly; cascades delete CRM data; does not undo Edge Function deploy by itself.  

**Do not** roll back by `db reset` or rewriting published migration history on the Lovable-linked project.

---

## 8. Verified vs unverified vs blocked (rollup)

### VERIFIED (today, without live apply)

- 0020/0021 SQL is additive, ordered, RLS-shaped correctly on inspection  
- CRM UI/routes/nav/auth gate exist; unit tests for ownership/idempotency/webhook correlation passed in Phase 5 verification  
- Phase 4 Svix handler + EF source include `campaign_recipient_id`  
- Env **names** identified; no secret values inspected or printed here  

### UNVERIFIED (need your live session)

- Current remote `schema_migrations` contents as of today  
- Post-apply PostgREST visibility of `crm_*`  
- Real Resend inbox delivery and open webhooks  
- Real HubSpot upsert success  
- Two-recruiter RLS on live JWTs  
- Production/host deployment of Phase 5 frontend  

### BLOCKED (CRM cannot be called “live”)

- Applying 0020/0021 without approval  
- Durable webhook event store without 0020  
- CRM persistence / non-EmptyState UI without 0021  
- Signed webhook production path without EF deploy + `RESEND_WEBHOOK_SECRET`  
- Phase 6 work (explicitly out of scope)  

---

## 9. What you need to do manually vs what needs explicit approval

### You should do manually (when ready)

1. Re-check Supabase Dashboard: confirm `email_delivery_events` / `crm_*` absent; note migration history.  
2. Add secret **values** yourself for the **names** in §4 (local server + Edge Function secrets). Do not paste them into chat.  
3. After approving apply: run SQL Editor applies for 0020 then 0021; verify tables.  
4. Deploy `resend-webhook`; wire Resend webhook URL; exercise §6 checklist with a test mailbox.  
5. Optionally create HubSpot custom properties.  
6. Decide separately whether to apply **0019** (OAuth) — not required for CRM.  

### Requires your explicit approval before Agent or anyone runs it

| Action | Why |
|---|---|
| Apply `PROPOSED_0020` / `PROPOSED_0021` (SQL Editor or scoped migrate) | Live DDL |
| Any `supabase db push` / `migration repair` / history rewrite | History desync risk |
| Deploy Edge Function to the linked project | Live infra |
| Edit `.env` / inject secrets via Agent | Secret handling policy |
| Destructive rollback (`DROP` CRM tables, `db reset`) | Data loss |
| Start **Phase 6** | Roadmap gate |
| Commit / push | Your release control |

### What Agent must not do in this track (reconfirmed)

- Apply migrations, run SQL against Supabase, deploy functions, edit `.env`, change RLS/code, start Phase 6, commit/push.

---

## 10. Suggested approval phrase (when you want go-live)

Example (edit as needed):

> Approve CRM live setup: apply PROPOSED_0020 then PROPOSED_0021 via SQL Editor only; I will set secrets and deploy resend-webhook myself. Do not db push, do not start Phase 6, do not commit.

Until you send an explicit approval of that form (or clearer), treat CRM live enablement as **BLOCKED** and Phase 6 as **not started**.

---

**STOP.** This document is complete. No live changes were performed.
