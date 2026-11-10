# HireHub Assessment 3 — CRM Security Audit (Phase 5)

**Date:** 2026-11-02  
**Mode:** Independent **READ-ONLY** audit (no SQL execution, no live mutating requests, no code/policy/env/deploy changes)  
**Scope:** Live CRM tables (user-confirmed present + RLS enabled) vs proposed policy SQL + `src/lib/crm/*` + `resend-webhook` EF  
**Assumption:** Production policies match `drizzle/migrations/PROPOSED_0020_email_delivery_events.sql` and `PROPOSED_0021_crm_tables.sql` (not re-queried from `pg_policies` in this session).

**Verdict labels:** `PASS` | `FAIL` | `NEEDS LIVE TEST`

**Phase 6:** Not started.

---

## Executive summary

| Area | Verdict |
|---|---|
| Row ownership on SELECT/UPDATE/DELETE via `recruiter_id` | **PASS** (policy design) |
| Seeker blocked from CRM writes | **PASS** (INSERT requires `current_role_is('recruiter')`) |
| Admin intended elevated access | **PASS** |
| Webhook event table: no authenticated INSERT | **PASS** |
| App-layer send AuthZ + segment owner check | **PASS** |
| **DB INSERT on `crm_campaign_recipients` does not bind `campaign_id` + `contact_id` + `recruiter_id`** | **FAIL** |
| **DB INSERT/UPDATE on `crm_campaigns` does not bind `segment_id` to same recruiter** | **FAIL** (DB); mitigated on send path in app |
| Cross-recruiter isolation under adversarial PostgREST | **FAIL** (recipient unique-key / cross-link insert); SELECT of peers’ rows **PASS** |
| Confirm live `pg_policies` ≡ proposed SQL | **NEEDS LIVE TEST** |

**Highest-priority issue:** Recipient INSERT RLS only checks `recruiter_id = auth.uid()` and role recruiter. It does **not** require that `campaign_id`’s campaign and `contact_id`’s contact share that same `recruiter_id`. A recruiter who learns another recruiter’s UUIDs can insert a recipient row that references foreign campaign/contact IDs while stamping their own `recruiter_id`, including risk of **UNIQUE (`campaign_id`, `contact_id`) contention** against the rightful owner.

---

## 1. RLS policies on the five tables

Source of truth for this audit: proposed SQL (user reports RLS enabled on all five in production).

### 1.1 `email_delivery_events` (PROPOSED_0020)

| Finding | Verdict | Notes |
|---|---|---|
| RLS enabled | **PASS** | `ALTER TABLE … ENABLE ROW LEVEL SECURITY` |
| Admin SELECT only | **PASS** | Policy `admins read email delivery events` |
| No authenticated INSERT/UPDATE/DELETE policies | **PASS** | Comments + grants: `GRANT SELECT` only |
| Seekers/recruiters cannot read events | **PASS** | Non-admin SELECT fails policy |
| Live policy text matches file | **NEEDS LIVE TEST** | Confirm in Dashboard / `pg_policies` |

### 1.2 `crm_contacts` / `crm_segments` / `crm_campaigns` / `crm_campaign_recipients`

Shared pattern (each table):

| Operation | Policy intent | Verdict |
|---|---|---|
| SELECT | `recruiter_id = auth.uid() OR admin` | **PASS** |
| INSERT | `recruiter_id = auth.uid() AND current_role_is('recruiter')` | **PASS** for self-owned `recruiter_id`; see §5 for FK cross-link gap on campaigns/recipients |
| UPDATE | Owner or admin USING + WITH CHECK | **PASS** for preventing reassignment to other owners on `recruiter_id` |
| DELETE | Owner or admin | **PASS** |
| No cross-table EXISTS in policies | Avoids L3 recursion class | **PASS** (design choice) |

---

## 2. CRM ownership checks in `src/lib/crm/`

| Finding | Verdict | Evidence |
|---|---|---|
| Central helper `canAccessCrmOwnedResource` / `assertCanMutateCrm` | **PASS** | `ownership.ts` — admin or matching recruiter id; never trusts body role alone |
| `sendCrmCampaign` AuthZ before service role | **PASS** | Loads campaign, checks `canAccessCrmOwnedResource`, then admin client |
| `softSyncCrmContactHubSpot` AuthZ before service role | **PASS** | Same pattern on contact row |
| List helpers filter by `recruiter_id` | **PASS** | `supabase-crm.ts` `.eq("recruiter_id", recruiterId)` |
| Client inserts set `recruiter_id` from caller context | **PASS** (happy path) | UI/adapters pass signed-in id; RLS still enforces |
| Unit tests for other-recruiter deny | **PASS** | `crm-phase5.test.ts` (memory store) — not a substitute for live RLS |

---

## 3. Campaign → segment ownership

| Layer | Verdict | Detail |
|---|---|---|
| DB FK `crm_campaigns.segment_id → crm_segments` | **PASS** as referential integrity only | Does **not** enforce same `recruiter_id` |
| DB INSERT/UPDATE campaign WITH CHECK | **FAIL** | Allows any `segment_id` UUID that exists while `recruiter_id = auth.uid()` |
| App `prepareCampaignSend` | **PASS** | Rejects when `campaign.recruiterId !== segment.recruiterId` |
| App send loads segment via service role after campaign AuthZ | **PASS** with reliance on prepare check | Without that check, admin client could read foreign segment; check is present |
| UI segment picker | **PASS** (UX) | Lists only caller’s segments via RLS; not a security boundary alone |

**Residual risk:** A recruiter can persist a campaign row pointing at another recruiter’s `segment_id` (if UUID known). Send path should refuse; listing may show a dangling/foreign segment id. Prefer a DB WITH CHECK or trigger (future hardening — out of scope for this read-only audit).

---

## 4. Campaign-recipient → campaign and contact ownership

| Layer | Verdict | Detail |
|---|---|---|
| FKs to `crm_campaigns` / `crm_contacts` / `profiles` | **PASS** | IDs must exist |
| UNIQUE `(campaign_id, contact_id)` | **PASS** for dedupe intent; **FAIL** under cross-tenant insert (see §5) | Attacker can occupy the unique pair |
| INSERT RLS | **FAIL** | Only `recruiter_id = auth.uid() AND recruiter` — **no** check that `campaign_id`’s `recruiter_id` and `contact_id`’s `recruiter_id` equal `recruiter_id` / `auth.uid()` |
| App send builds recipients from owned campaign + owned contacts | **PASS** | `prepareCampaignSend` + contacts filtered by `campaign.recruiterId` |
| Recipient rows stamped with campaign owner’s `recruiterId` | **PASS** on happy path | `prepareCampaignSend` sets `recruiterId: input.campaign.recruiterId` |

**Required cohesion (not enforced in SQL today):**

```text
crm_campaigns.id = campaign_id AND crm_campaigns.recruiter_id = NEW.recruiter_id
AND crm_contacts.id = contact_id AND crm_contacts.recruiter_id = NEW.recruiter_id
AND NEW.recruiter_id = auth.uid()
```

---

## 5. Direct Supabase requests — cross-recruiter abuse

Assumes JWT of Recruiter A; UUIDs of Recruiter B’s rows known or guessed.

| Attack | Expected with current policies | Verdict |
|---|---|---|
| `SELECT` B’s contacts/segments/campaigns/recipients | Denied (RLS) | **PASS** (design) |
| `UPDATE`/`DELETE` B’s rows | Denied | **PASS** (design) |
| `INSERT` contact with `recruiter_id = B` | Denied (WITH CHECK) | **PASS** |
| `INSERT` campaign with A’s `recruiter_id` + B’s `segment_id` | Allowed by RLS | **FAIL** |
| `INSERT` recipient with A’s `recruiter_id` + B’s `campaign_id` + B’s `contact_id` | Allowed by RLS; may block B’s later enroll via UNIQUE | **FAIL** |
| `INSERT` recipient with B’s `recruiter_id` | Denied | **PASS** |
| Prove with two live JWTs | Not executed this session | **NEEDS LIVE TEST** |

**Impact of FAIL cases:** Does not grant A a SELECT of B’s PII via RLS, but enables referential pollution / unique-key denial and inconsistent CRM graph until cleaned by admin/service role.

---

## 6. Admins and job seekers — intended permissions

| Actor | Intended | Policy/code | Verdict |
|---|---|---|---|
| Job seeker | No CRM access | INSERT requires recruiter; SELECT only own `recruiter_id` (seeker uid ≠ owner) | **PASS** (design) |
| Job seeker route gate | `/recruiter/*` redirected | `_app.recruiter` `wrongRoleHome` | **PASS** |
| Admin | Read/write all CRM for support | `current_role_is('admin')` on SELECT/UPDATE/DELETE; INSERT still requires **recruiter** role | **PASS** with note |
| Admin INSERT contacts/campaigns | Cannot INSERT unless also `current_role_is('recruiter')` | By design of INSERT policies | **PASS** (intentional restriction) — admins update/delete existing rows; creating as admin-only account needs role or service role |
| Admin UI CRM | Not a first-class admin nav CRM | Recruiter workspace only | **PASS** / product note |

Seeker/admin live JWT confirmation: **NEEDS LIVE TEST**.

---

## 7. Webhook writes — service role / Edge Function only

| Finding | Verdict | Evidence |
|---|---|---|
| `email_delivery_events` no authenticated INSERT policy | **PASS** | PROPOSED_0020 |
| GRANT SELECT only for authenticated | **PASS** | No INSERT/UPDATE/DELETE grants |
| EF uses `SUPABASE_SERVICE_ROLE_KEY` for insert + recipient update | **PASS** | `supabase/functions/resend-webhook/index.ts` |
| Svix required; cron secret rejected | **PASS** | Same EF |
| Authenticated user cannot forge delivery events via PostgREST | **PASS** (design) |
| EF recipient `UPDATE` bypasses RLS (service role) | **PASS** for ingest; ensure only after signature verify | Signature verified before write |
| Live EF deployed with this code + secret | **NEEDS LIVE TEST** | Deploy status not verified here |

---

## 8. Finding register (complete)

| ID | Finding | Verdict |
|---|---|---|
| F01 | Five CRM-related tables use RLS with owner/admin SELECT pattern | **PASS** |
| F02 | `email_delivery_events` webhook store: authenticated read-admin / write-none | **PASS** |
| F03 | Seekers cannot INSERT CRM rows | **PASS** |
| F04 | Admins can SELECT/UPDATE/DELETE all CRM; INSERT gated to recruiter role | **PASS** |
| F05 | App send/sync AuthZ via `canAccessCrmOwnedResource` before service role | **PASS** |
| F06 | App enforces campaign↔segment same recruiter on send | **PASS** |
| F07 | App send audience limited to contacts of campaign owner | **PASS** |
| F08 | DB does not enforce campaign.`segment_id` same-recruiter as campaign | **FAIL** |
| F09 | DB does not enforce recipient `(campaign_id, contact_id, recruiter_id)` cohesion on INSERT | **FAIL** |
| F10 | Cross-tenant UNIQUE(`campaign_id`,`contact_id`) occupation possible | **FAIL** |
| F11 | Peer recruiter cannot SELECT others’ CRM rows under intended RLS | **PASS** (design) |
| F12 | Production `pg_policies` equals proposed SQL | **NEEDS LIVE TEST** |
| F13 | Two-recruiter adversarial PostgREST proof | **NEEDS LIVE TEST** |
| F14 | Live webhook EF + Svix path | **NEEDS LIVE TEST** |
| F15 | Seeker JWT denied CRM PostgREST | **NEEDS LIVE TEST** |

---

## 9. Recommended hardening (documentation only — do not apply in this audit)

Future approved migration (not written/applied here) should add WITH CHECK / trigger such as:

- On `crm_campaigns` INSERT/UPDATE: `segment_id IS NULL OR EXISTS (SELECT 1 FROM crm_segments s WHERE s.id = segment_id AND s.recruiter_id = recruiter_id)`.
- On `crm_campaign_recipients` INSERT/UPDATE: EXISTS campaign and contact with matching `recruiter_id = NEW.recruiter_id`.

Until then: treat direct PostgREST recipient/campaign writes as a trust boundary; prefer server functions for mutations; monitor for anomalous recipient rows.

---

## 10. What was not done

- No `SELECT` against production `pg_policies` / no mutating API calls  
- No code, migration, RLS, `.env`, or deploy changes  
- Phase 6 not started  

---

## 11. Stop

Audit complete. Address **F08–F10** with an explicit follow-up approval before treating CRM DB isolation as fully closed. Live items **F12–F15** remain for your manual JWT/EF checks.
