# HireHub Assessment 3 — Phase 5 Live Integration Readiness

**Date:** 2026-11-02  
**Project:** `munqgybiuqpncxbgfvdp`  
**Mode:** Read-only audit (no `.env` edits, no code changes, no deploy, no real emails, no migration apply/history repair, no Phase 7, no commit/push)  
**Inputs:** Phase 4/5 reports, Phase 5 final verification, engineering rules, roadmap, integration contracts, CRM live setup checklist, source under `src/lib/integrations/*`, `src/lib/crm/*`, `supabase/functions/resend-webhook`, PROPOSED_0020–0022  

**Overall verdict:** Product code for Resend + Svix webhook + optional HubSpot is **implemented and unit-tested**. CRM schema (0020–0022) is **reported live** from prior verification. **Live email / webhook demo is still BLOCKED** on missing secrets, missing Edge Function deploy, Resend dashboard wiring, and a `config.toml` JWT-gateway gap for `resend-webhook`.

| Verdict labels | Meaning |
|---|---|
| **READY** | Implemented / present; safe to use once ops steps done |
| **CONFIGURED** | Present in local or documented host config (names only; values never printed) |
| **MISSING** | Credential or external account step not done |
| **BLOCKED** | Demo path cannot succeed until cleared |
| **OPTIONAL** | Not required for Phase 5 acceptance; soft-skips if absent |
| **UNVERIFIED** | Cannot confirm live without dashboard/CLI against production |

---

## Executive summary

| Track | Status |
|---|---|
| Outbound Resend (application-status + CRM campaign) | **READY** in code; local From fallback **CONFIGURED**; hosted secrets **UNVERIFIED** |
| Inbound Svix `resend-webhook` | **READY** in code; deploy **BLOCKED**; secret **MISSING**; `verify_jwt=false` **MISSING** in `supabase/config.toml` |
| HubSpot sync | **READY** in code; token **MISSING**; **OPTIONAL** for Phase 5 acceptance |
| CRM / `email_delivery_events` DDL | Assumed **live** (prior user evidence); history registration **MISSING** |
| Phase 7 | **Not started** (correct) |

---

## 1. Already implemented

### Resend outbound

| Path | Location | Behavior |
|---|---|---|
| Application-status email | `src/lib/integrations/application-status-mail.ts` + soft wire after in-app notify via `deliver-application-integrations(.server).ts` → `notify-application-status.ts` | Additive to in-app notify; soft-skip if provider missing |
| CRM campaign email | `src/lib/crm/campaign-mail.ts` + `send-campaign.server.ts` | Confirm-to-send; Resend `POST https://api.resend.com/emails` |
| Env name resolver | `src/lib/integrations/env.ts` | `RESEND_FROM_EMAIL` preferred; falls back to `CONTACT_FROM_EMAIL` |
| Error classification | `src/lib/resend-errors.ts` | Maps testing-domain / unauthorized / other; UI messages never leak key names |

**Outbound tags for webhook correlation**

- Status mail: `hirehub_kind=application_status`, `application_id=…`
- Campaign mail: `hirehub_kind=crm_campaign`, `campaign_id`, `campaign_recipient_id`, `contact_id`

**Idempotency / error handling (outbound)**

| Concern | Implementation | Limitation |
|---|---|---|
| Status mail key | `email:application_status:{applicationId}:{status}` | Process-local `Set` only (not cross-instance / not DB) |
| Campaign send | Unique `send_idempotency_key` on campaign + recipient; `prepareCampaignSend` returns `alreadySent` | No Resend `Idempotency-Key` HTTP header |
| Missing API key / From | Soft `provider_not_configured` (`ok: true, skipped: true`) | Hosted demo needs same names set on app host |
| Resend HTTP failure | `ok: false` with `resend_*` reason; notify/CRM SoT not rolled back | Soft-fail by design |

### Webhook (Svix)

| Piece | Location |
|---|---|
| Pure handler | `src/lib/integrations/resend-webhook.ts` |
| Signature verify | `src/lib/integrations/svix-verify.ts` (HMAC-SHA256, `whsec_` decode, ±300s skew, timing-safe) |
| Deployable EF | `supabase/functions/resend-webhook/index.ts` |
| Memory store (tests) | `src/lib/integrations/email-delivery-store.ts` |
| Unit coverage | `src/test/integrations-phase4.test.ts`, `src/test/crm-phase5.test.ts` |

**Supported event types → tracking**

| Resend type | Mapped tracking |
|---|---|
| `email.sent`, `email.delivered` | `sent` |
| `email.opened` | `opened` |
| `email.bounced` | `bounced` |
| `email.complained` | `complained` |
| Other / unknown | `other` (still 200 after verify + idempotent record) |

**Replay / DB tracking**

- Auth: Svix headers only; **rejects** `x-hirehub-cron-secret`
- Idempotency key: `svix-id` → `email_delivery_events.event_id` **UNIQUE** (23505 → `duplicate: true`)
- After verify: service-role insert into `email_delivery_events`; soft-update `crm_campaign_recipients` when `campaign_recipient_id` tag present
- If table missing: still returns **200** after valid signature (avoids Resend retry storms)

### HubSpot

| Path | Location | Fields synced |
|---|---|---|
| Application status sync | `src/lib/integrations/hubspot-sync.ts` | `email`, `firstname`, `lastname`, `hirehub_application_id`, `hirehub_job_title`, `hirehub_application_status`, optional `hirehub_company` |
| CRM contact sync | `src/lib/crm/hubspot-contact-sync.ts` (+ `sync-contact.server.ts`; also during campaign send) | `email`, `firstname`, `lastname`, `hirehub_crm_contact_id`, optional `hirehub_segment_kind` |

Upsert by email (`PATCH …?idProperty=email`, create on 404). Soft-skip when token missing. HireHub remains CRM SoT.

### CRM product (Phase 5)

- Routes `/recruiter/crm*`, nav item, domain libs, schema probe EmptyState
- Ownership integrity **PROPOSED_0022** (composite FKs) — reported applied in final verification
- Unit tests for ownership, send idempotency, webhook replay, HubSpot soft-fail

### Exact deploy command (manual — not run in this audit)

```bash
npx supabase functions deploy resend-webhook --project-ref munqgybiuqpncxbgfvdp
```

---

## 2. Already configured and verified

### Local `.env` presence check (names only — values never displayed)

| Name | Local `.env` |
|---|---|
| `RESEND_API_KEY` | **SET_NONEMPTY** |
| `CONTACT_FROM_EMAIL` | **SET_NONEMPTY** (acts as From fallback) |
| `RESEND_FROM_EMAIL` | **MISSING** (fallback covers local From if `CONTACT_FROM_EMAIL` is a valid Resend sender) |
| `RESEND_WEBHOOK_SECRET` | **MISSING** |
| `HUBSPOT_ACCESS_TOKEN` | **MISSING** |

### Schema / prior verification (not re-queried this session)

| Item | Status |
|---|---|
| CRM tables + RLS + six composite constraints (0022) | **PASS** per `ASSESSMENT_3_PHASE_5_FINAL_VERIFICATION.md` (user live evidence) |
| `email_delivery_events` expected with CRM go-live | Assumed present if 0020 applied with 0021; **UNVERIFIED** re-probe this session |
| Unit tests (Phase 4/5) | Previously green (518–531 suite; ownership + CRM + webhook spot sets) |
| Existing Resend use (contact form) | Code + `RESEND_API_KEY` / `CONTACT_FROM_EMAIL` already in product path |

### Explicitly not verified here

- Hosted (Vercel/Lovable) secret store for Resend/HubSpot  
- Live Edge Function list / deploy status of `resend-webhook`  
- Resend domain verification / dashboard webhook endpoint  
- Live `schema_migrations` rows for 0020–0022  
- End-to-end inbox delivery or open-pixel webhook  

---

## 3. Missing credentials or external account setup

### Required for live CRM send + tracking demo

| Item | Where | Notes |
|---|---|---|
| `RESEND_API_KEY` | App host (local + production server secrets) | Local present; **production host UNVERIFIED** |
| `RESEND_FROM_EMAIL` **or** working `CONTACT_FROM_EMAIL` | App host | Prefer dedicated CRM From; must be allowed by Resend |
| Verified Resend sending domain (or accept free-tier limit) | Resend Dashboard | `onboarding@resend.dev` / unverified domain typically only delivers to the Resend account inbox |
| `RESEND_WEBHOOK_SECRET` | **Supabase Edge Function secrets** (and optionally local if testing handler offline) | Svix signing secret from Resend webhook endpoint (`whsec_…`) |
| Deployed `resend-webhook` function | Supabase project `munqgybiuqpncxbgfvdp` | Code on disk only |
| Resend Dashboard webhook URL | Points at EF HTTPS URL | Events: at least `email.sent`, `email.delivered`, `email.opened`, `email.bounced`, `email.complained` |
| `[functions.resend-webhook] verify_jwt = false` | `supabase/config.toml` **or** Dashboard equivalent | **GAP:** config today only sets JWT for `notify-application-status` / `close-expired-jobs`. Default JWT verify would **block** Resend (no user JWT). Fix before claiming webhook live |

### Optional (soft-fail; not Phase 5 acceptance blockers)

| Item | Notes |
|---|---|
| `HUBSPOT_ACCESS_TOKEN` | Private app / OAuth token with Contacts write (and read if portal requires) |
| HubSpot custom properties | `hirehub_application_id`, `hirehub_job_title`, `hirehub_application_status`, `hirehub_company`, `hirehub_crm_contact_id`, `hirehub_segment_kind` — missing props cause soft HTTP failures |
| `HUBSPOT_CLIENT_SECRET` | **Not required** for v1 outbound-only |
| History markers for `20261102120000` / `20261102130000` / `20261102140000` | Recommended ops hygiene; **not** required to send mail if DDL already live |

### Forbidden / do not use

- Any `VITE_RESEND_*`, `VITE_HUBSPOT_*`, or `VITE_` service-role keys  
- Cron secret as webhook auth  
- Printing or committing secret values  

---

## 4. Exact manual actions you must perform

Do these yourself when ready. This audit does **not** authorize the agent to run them.

1. **Confirm live tables (read-only SQL in Dashboard)**  
   - `email_delivery_events` exists (incl. `campaign_recipient_id` if 0021 ran after/with 0020)  
   - `crm_contacts`, `crm_segments`, `crm_campaigns`, `crm_campaign_recipients`  
   - Optional: `SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 40;` — expect 0020–0022 **may be missing** from history even if DDL is live  

2. **Set app-host secrets** (local `.env` you edit; production secret store separately)  
   - Ensure `RESEND_API_KEY`  
   - Set `RESEND_FROM_EMAIL` to a Resend-allowed From (or keep relying on `CONTACT_FROM_EMAIL`)  
   - Do **not** put secrets under `VITE_`  

3. **Resend account**  
   - Prefer verifying a sending domain for multi-recipient demos  
   - Or use only the Resend account email as campaign recipient under free-tier testing rules  

4. **Fix Edge Function JWT gateway for webhooks**  
   - Add (or set in Dashboard) `verify_jwt = false` for function name `resend-webhook` so Svix POSTs are not rejected at the gateway  
   - Keep auth as Svix-only inside the function  

5. **Set Edge Function secret**  
   - `RESEND_WEBHOOK_SECRET` = Svix secret from Resend (after endpoint created, or create endpoint then paste secret)  
   - Confirm platform injects `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` for functions  

6. **Deploy**  
   ```bash
   npx supabase functions deploy resend-webhook --project-ref munqgybiuqpncxbgfvdp
   ```  

7. **Wire Resend webhook**  
   - Endpoint = `https://munqgybiuqpncxbgfvdp.supabase.co/functions/v1/resend-webhook` (confirm after deploy)  
   - Subscribe to the event types listed above  

8. **Optional HubSpot**  
   - Create private app token; enable Contacts read/write scopes  
   - Create custom properties listed in §3  
   - Set `HUBSPOT_ACCESS_TOKEN` on app host  

9. **Optional history markers only** (separate explicit approval; **do not re-run DDL**)  
   - Register `20261102120000`, `20261102130000`, `20261102140000` if missing — pattern in Phase 5 final verification  

10. **Smoke demo** as recruiter with a mailbox you control (see §6)

---

## 5. Safe deployment and testing sequence

Order matters. Do **not** `db push`, `db reset`, or rewrite migration history.

```text
0. Read-only confirm CRM + email_delivery_events already live
1. App secrets: RESEND_API_KEY + From (RESEND_FROM_EMAIL or CONTACT_FROM_EMAIL)
2. Ensure resend-webhook verify_jwt = false (config or Dashboard)
3. Deploy: npx supabase functions deploy resend-webhook --project-ref munqgybiuqpncxbgfvdp
4. Set EF secret RESEND_WEBHOOK_SECRET
5. Resend Dashboard → webhook URL + events
6. Sanity (manual):
   - POST without Svix headers → 401
   - POST with only x-hirehub-cron-secret → 401
7. CRM UI: contact → segment → campaign → preview → confirm send
8. Open message → webhook 200 → recipient tracking opened / email_delivery_events row
9. Confirm-send again → alreadySent / no duplicate blast
10. Optional: set HubSpot token + re-send/sync → hubspot_contact_id or soft-fail reason
```

**Rollback (non-destructive):** disable Resend webhook endpoint; leave tables and function in place.

---

## 6. Acceptance criteria for the live demo

### Must pass (Phase 5 live email + webhook claim)

| # | Criterion |
|---|---|
| L1 | Recruiter opens `/recruiter/crm` without schema EmptyState |
| L2 | Create contact + segment (`new` \| `active` \| `placed`) + campaign draft |
| L3 | Preview ready; send blocked without explicit confirm |
| L4 | Confirm send with Resend configured → recipient(s) move to `sent` (or documented soft-skip only if provider intentionally unset — **not** acceptable for “live demo”) |
| L5 | Message visible in Resend dashboard and/or recipient inbox |
| L6 | Open (or Resend test open) → signed webhook **200**; row in `email_delivery_events` keyed by `svix-id` |
| L7 | Campaign tracking UI shows `opened` (or at least `sent`/`delivered` then `opened`) |
| L8 | Webhook replay / duplicate `svix-id` → **200** `duplicate: true`; no duplicate side effects |
| L9 | Unsigned / invalid signature → **401**; cron header alone → **401** |
| L10 | Second confirm send is idempotent (`alreadySent` / no mass re-mail) |
| L11 | In-app application-status notify still works if Resend fails (soft-fail) |

### Optional (nice for marks; not required to claim CRM SoT)

| # | Criterion |
|---|---|
| O1 | `HUBSPOT_ACCESS_TOKEN` set → contact upsert; `hubspot_contact_id` stored or sync reason recorded |
| O2 | Token unset → CRM send/tracking still works (`provider_not_configured`) |
| O3 | Migration history markers for 0020–0022 registered |

### Explicitly out of scope for this readiness gate

- Phase 6/7 agent work  
- IMAP auto-`replied`  
- Dual HubSpot-primary CRM UI  
- Applying or repairing migrations via Agent  

---

## CHECK rollup

### CHECK 1 — Resend

| Item | Finding |
|---|---|
| Implementation | **READY** — status + campaign paths |
| Env names | `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `CONTACT_FROM_EMAIL` (fallback) |
| Domain / sender | Must use Resend-allowed From; verify domain for non-account recipients |
| Idempotency | Campaign DB keys **READY**; status mail process-local only |
| Errors | Soft-skip / classified failures **READY** |

### CHECK 2 — Webhook

| Item | Finding |
|---|---|
| EF source | **READY** — `supabase/functions/resend-webhook/index.ts` |
| Secret | `RESEND_WEBHOOK_SECRET` — **MISSING** locally |
| Svix verify | **READY** (skew + HMAC + cron reject) |
| Events | sent/delivered/opened/bounced/complained |
| Replay / DB | `event_id` unique + recipient patch **READY** in code |
| Deploy command | `npx supabase functions deploy resend-webhook --project-ref munqgybiuqpncxbgfvdp` |
| Gateway JWT | **BLOCKED** until `verify_jwt = false` for this function |

### CHECK 3 — HubSpot

| Item | Finding |
|---|---|
| Implementation | **READY** — application + CRM soft sync |
| Token | `HUBSPOT_ACCESS_TOKEN` — **MISSING** |
| Scopes / props | Contacts write (+ custom properties as listed) |
| Phase 5 acceptance | **OPTIONAL** — HireHub is SoT; sync soft-skips |

### CHECK 4 — Database / migrations

| Item | Finding |
|---|---|
| Live tables/constraints | Assumed applied (final verification); not re-queried here |
| Repo mirrors | `20261102120000`, `20261102130000`, `20261102140000` on disk |
| `scripts/_register_migration_history.sql` | **No** 0020/0021/0022 rows |
| This audit | **Did not** change history, apply DDL, or `db push` |

### CHECK 5 — Deployment

| Item | Finding |
|---|---|
| EF code | **READY** to deploy |
| `config.toml` entry for `resend-webhook` | **MISSING** (`verify_jwt` gap) |
| Secrets prerequisite | `RESEND_WEBHOOK_SECRET` + platform URL/service role |
| Deployed live? | **UNVERIFIED / treat as not deployed** until Dashboard confirms |

---

## Stop statement

Read-only readiness audit complete. **No** secrets printed, **no** `.env` edits, **no** code/DB changes, **no** deploy, **no** real emails, **no** migration-history mutation, **no** Phase 7.

**Next step for you:** complete §4 manual actions (JWT gateway fix → secrets → deploy → Resend webhook URL → smoke §6). Approve separately if you want the agent to patch `supabase/config.toml` only, or to draft history-marker SQL only — neither was done here.
