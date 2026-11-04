# HireHub Assessment 3 — Integration Contracts (Phase 3)

**Status:** Contract baseline — Phase 4–5 implementation complete (code); Phase 6 not started  
**Date:** 2026-11-02  
**Authority:** Phase 3 approved; vendors/CRM model below are the working baseline (recommended stack from engineering rules).  
**Implementation:** Phase 4 integrations + Phase 5 `/recruiter/crm` UI + `PROPOSED_0021`. `PROPOSED_0020`/`0021` written but **not applied**.

---

## 1. Approved integration pair (Track 1)

| Role | Vendor | Direction |
|---|---|---|
| Email delivery | **Resend** | Outbound API + **inbound Svix-signed webhook** |
| CRM / candidate sync | **HubSpot** (free tier) | Outbound API sync |
| Fallback (only if HubSpot blocked) | Resend + **Stripe test** webhook | Not default |

**Explicit non-goals for v1:** Google Calendar, Slack, dual HubSpot-primary UI.

**Reuse today:** Resend already used for contact/account mail (`submit-contact.ts`, `send-account-mail.ts`, `RESEND_API_KEY`). In-app status notify remains (`notify-application-status`) — email is **additive**, not a replacement.

**Not a Track 1 webhook:** cron shared secrets (`LOVABLE_CRON_SECRET` / `x-hirehub-cron-secret`) authenticate scheduled jobs only. They **do not** satisfy “inbound webhook with verified vendor signature.”

---

## 2. CRM source of truth (Track 2)

| Concern | Owner |
|---|---|
| In-app segments, campaigns, tracking UI | **HireHub** (lightweight custom tables) — **system of record for UX** |
| Optional external mirror | HubSpot contact/deal properties via sync ids |
| Forbidden | Two competing CRMs with divergent campaign state |

Segments (official): `new` | `active` | `placed`  
Campaign tracking (official): `sent` | `opened` | `replied` | `applied`

---

## 3. Environment variable names (server-only — never `VITE_`)

**Do not put values in git.** User sets secrets manually in `.env` / host secret store. Phase 3 does not edit `.env`.

### Existing (keep)
| Name | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend API auth |
| `CONTACT_FROM_EMAIL` | Contact form From |
| `CONTACT_TO_EMAIL` | Contact form To (optional) |

### New for Phase 4+ (names only)
| Name | Purpose |
|---|---|
| `RESEND_FROM_EMAIL` | From for application-status + campaign mail (may equal contact from) |
| `RESEND_WEBHOOK_SECRET` | Svix signing secret from Resend webhook endpoint |
| `HUBSPOT_ACCESS_TOKEN` | Private app token (outbound sync) |
| `HUBSPOT_CLIENT_SECRET` | Optional; only if validating HubSpot inbound later (v1 outbound-only) |

Optional reuse of existing account-mail from if already configured in code — Phase 4 must not invent `VITE_` variants.

---

## 4. Outbound A — Application-status email (Resend)

### Trigger
Recruiter/admin status update path that already calls `notify-application-status` / status update helpers.

### Behavior
1. Keep **in-app** notification (existing EF + dedupe `application_status:{applicationId}:{status}`).  
2. **Additionally** send Resend email to seeker’s profile email when configured.  
3. Failures: classify via `resend-errors` patterns; never leak API keys; in-app notify still succeeds if email fails.

### Suggested JSON body (Resend `POST https://api.resend.com/emails`)
```json
{
  "from": "<RESEND_FROM_EMAIL>",
  "to": ["<seeker_email>"],
  "subject": "HireHub: application update — <job_title>",
  "html": "<safe server-rendered summary; no secrets>",
  "headers": {
    "X-HireHub-Application-Id": "<application_uuid>",
    "X-HireHub-Status": "<applied|shortlisted|interview|hired|rejected>"
  },
  "tags": [
    { "name": "hirehub_kind", "value": "application_status" },
    { "name": "application_id", "value": "<application_uuid>" }
  ]
}
```

### Idempotency (outbound)
- Key: `email:application_status:{applicationId}:{status}`  
- Store provider message id when returned; skip re-send if key already `sent`/`delivered`.

### AuthZ
Same as notify EF: JWT + job owner or admin from **database**, never body `userId`/`role`.

---

## 5. Outbound B — HubSpot candidate sync

### Triggers (minimum)
- Application created (`status=applied`)  
- Application status changes to `shortlisted` | `interview` | `hired` | `rejected`  
- Optional: CRM campaign recipient enrolled

### Contact properties (HireHub → HubSpot)
| HireHub | HubSpot (suggested) |
|---|---|
| seeker email | `email` (unique upsert key) |
| full_name | `firstname` / `lastname` (best-effort split) |
| application id | custom `hirehub_application_id` |
| job title | custom `hirehub_job_title` |
| application status | custom `hirehub_application_status` |
| company name | custom `hirehub_company` |

### Idempotency
- Upsert contact by email; store `hubspot_contact_id` on HireHub side when tables exist (Phase 5).  
- Sync event key: `hubspot:sync:{applicationId}:{status}`.

### Auth
`Authorization: Bearer <HUBSPOT_ACCESS_TOKEN>` server-only.

---

## 6. Inbound — Resend webhook (Svix signature)

### Endpoint (Phase 4 choice — one of)
- Supabase Edge Function `resend-webhook`, **or**  
- TanStack server route under a fixed path (e.g. `/api/webhooks/resend`)

### Required headers (Svix)
| Header | Purpose |
|---|---|
| `svix-id` | Event id (idempotency) |
| `svix-timestamp` | Replay window |
| `svix-signature` | HMAC signature(s) |

### Verification algorithm (contract)
1. Reject if any Svix header missing → **401**.  
2. Verify signature with `RESEND_WEBHOOK_SECRET` per Resend/Svix docs (timing-safe compare).  
3. Reject invalid signature → **401**.  
4. Reject stale timestamp outside allowed skew → **401**.  
5. Parse JSON body; ignore unknown event types with **200** after idempotent no-op (avoid retry storms).

### Events to handle (v1)
| Resend/Svix type (typical) | HireHub effect |
|---|---|
| `email.sent` | Mark delivery/campaign recipient `sent` if correlated |
| `email.delivered` | Optional refine of `sent` |
| `email.opened` | Mark tracking `opened` |
| `email.clicked` | Optional; may map to engagement note |
| `email.bounced` / `email.complained` | Store failure; do not invent “opened” |

Correlation: prefer Resend `email_id` / tags `application_id` or campaign recipient id set on outbound.

### Idempotency (inbound)
- Unique key: `svix-id` (or provider event id).  
- Table candidate (Phase 4, additive only, **apply with approval**): `email_delivery_events`  
  - `provider` text, `event_id` text **UNIQUE**, `email_id` text null, `event_type` text, `payload_meta` jsonb (no raw PII dumps), `created_at`.  
- Replay of same `svix-id` → no duplicate side effects; return **200**.

### Explicit rejects (test plan — implement in Phase 4)
| Case | Expected |
|---|---|
| No Svix headers | 401 |
| Wrong signature | 401 |
| Valid signature, duplicate `svix-id` | 200, row count unchanged |
| Valid `email.opened` for known outbound | tracking → `opened` |

**Cron Bearer secret must not be accepted as a substitute for Svix.**

---

## 7. CRM tracking state map

| CRM state | Primary signal | Secondary |
|---|---|---|
| `sent` | Outbound Resend success **or** webhook `email.sent`/`delivered` | Local send receipt |
| `opened` | Webhook `email.opened` | — |
| `replied` | **Manual** recruiter mark in HireHub v1 (no IMAP) | Optional later |
| `applied` | HireHub `applications` row for campaign job/seeker | HubSpot sync status |

---

## 8. Candidate additive schema (Phase 4/5 — not applied in Phase 3)

Design notes only:

1. `email_delivery_events` — webhook idempotency (§6).  
2. `crm_segments` / `crm_campaigns` / `crm_campaign_recipients` — recruiter-owned RLS; recipient has `tracking_status`, `resend_email_id`, optional `hubspot_contact_id`.  

No DDL in Phase 3. No `db push`. Follow PROPOSED additive migration workflow when Phase 4/5 approved.

---

## 9. Security rules (carry into Phase 4)

1. Never `VITE_` for Resend/HubSpot/webhook secrets.  
2. Never log API keys, tokens, or full webhook payloads with PII.  
3. Never trust identity fields in webhook or notify bodies.  
4. Do not weaken RLS to sync HubSpot.  
5. Keep service role off user apply/resume paths (Phase 1).  
6. Preserve in-app notify if email provider fails.

---

## 10. Phase 4 implementation order (preview — do not start here)

1. Resend application-status outbound + idempotency store.  
2. Resend Svix webhook verify + `email_delivery_events`.  
3. HubSpot outbound sync on status transitions.  
4. Tests from §6 table.  
5. Then Phase 5 CRM UI against these contracts.

---

## 11. Acceptance checklist (Phase 3)

- [x] Vendors named: Resend + HubSpot (+ Resend Svix inbound)  
- [x] Outbound shapes specified (email + HubSpot)  
- [x] Inbound signature verification + idempotency specified  
- [x] Unsigned/invalid → 401 planned  
- [x] CRM single source of truth stated  
- [x] Env **names** listed; `.env` not edited  
- [x] No vendor feature code in this phase  
