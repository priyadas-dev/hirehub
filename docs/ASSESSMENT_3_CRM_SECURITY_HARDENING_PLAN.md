# HireHub Assessment 3 — CRM Security Hardening Plan

**Status:** Implementation authored on disk — **not applied to production**  
**Date:** 2026-11-02  
**Inputs:** `docs/ASSESSMENT_3_CRM_SECURITY_AUDIT.md` (F08–F10), `PROPOSED_0020` / `PROPOSED_0021`, `src/lib/crm/*`  
**Implementation (approved):** `drizzle/migrations/PROPOSED_0022_crm_ownership_integrity.sql` + Supabase mirror `supabase/migrations/20261102140000_proposed_0022_crm_ownership_integrity.sql`; unit mirrors in `src/lib/crm/ownership-integrity.ts` / `src/test/crm-ownership-integrity.test.ts`.

**Apply still requires a separate explicit approval.** Do not `db push`, deploy, or start Phase 6 from this document alone.

---

## 1. Problem summary (from audit)

| ID | Gap | Attack |
|---|---|---|
| F08 | `crm_campaigns.segment_id` not bound to same `recruiter_id` | Recruiter A inserts/updates campaign with B’s `segment_id` |
| F09 | Recipient INSERT RLS only checks `recruiter_id = auth.uid()` | A inserts recipient referencing B’s `campaign_id` / `contact_id` while stamping A’s `recruiter_id` |
| F10 | `UNIQUE (campaign_id, contact_id)` is global | A can occupy B’s pair and block B’s legitimate enroll |

App-layer send (`prepareCampaignSend`) already rejects mismatched segment owners — **insufficient alone**. Hardening must be **database-enforced**.

---

## 2. Design principles

1. **Database enforcement first** — composite foreign keys (preferred) + optional SECURITY DEFINER helpers for RLS defense-in-depth.  
2. **No RLS recursion** — do **not** put bare `EXISTS (SELECT … FROM crm_* …)` inside RLS policies that read other RLS tables under the invoker. Follow HireHub L3 lesson (`PROPOSED_0017` pattern: definer helpers with fixed `search_path` if helpers are used).  
3. **Preserve** recruiter isolation, admin SELECT/UPDATE/DELETE, seeker non-access, webhook service-role writes.  
4. **Do not weaken** existing SELECT policies or `email_delivery_events` “no authenticated INSERT”.  
5. **Additive** — no `DROP TABLE`; no rewrite of 0020/0021 history; new proposed migration only.  
6. **Preserve good rows** — validate/fix orphans before adding FKs that would fail apply.

---

## 3. Recommended approach: composite foreign keys

### Why this beats RLS-only EXISTS

| Approach | Pros | Cons |
|---|---|---|
| **Composite FK** `(segment_id, recruiter_id) → segments(id, recruiter_id)` etc. | Enforced for **all** writers (PostgREST, EF service role, SQL Editor); no policy recursion; fixes F10 because A cannot reference B’s campaign id with A’s recruiter_id | Needs unique `(id, recruiter_id)` on parents (safe: `id` already PK) |
| RLS WITH CHECK + invoker EXISTS | Looks simple | Recursion / policy coupling risk (L3) |
| SECURITY DEFINER helpers in RLS only | Safe reads under definer | Service role still bypasses RLS — **does not** stop malicious service-role or SQL unless FK also present |

**Decision:** Primary control = **composite FKs**. Optional secondary = definer helpers in WITH CHECK for authenticated clarity (not required if FKs land).

### 3.1 Parent uniqueness (additive)

```sql
-- Conceptual (not applied):
ALTER TABLE public.crm_segments
  ADD CONSTRAINT crm_segments_id_recruiter_unique UNIQUE (id, recruiter_id);

ALTER TABLE public.crm_campaigns
  ADD CONSTRAINT crm_campaigns_id_recruiter_unique UNIQUE (id, recruiter_id);

ALTER TABLE public.crm_contacts
  ADD CONSTRAINT crm_contacts_id_recruiter_unique UNIQUE (id, recruiter_id);
```

(`id` PK already implies uniqueness of `id`; composite unique enables composite FK.)

### 3.2 Campaign → segment same owner (fixes F08)

```sql
-- Conceptual:
ALTER TABLE public.crm_campaigns
  ADD CONSTRAINT crm_campaigns_segment_same_recruiter_fkey
  FOREIGN KEY (segment_id, recruiter_id)
  REFERENCES public.crm_segments (id, recruiter_id)
  ON DELETE SET NULL (segment_id);  -- PG15+ column list; NEVER bare SET NULL
```

**Semantics (PostgreSQL MATCH SIMPLE):**  
- `segment_id IS NULL` → FK not enforced (draft campaigns without audience remain valid).  
- Non-null `segment_id` → row’s `recruiter_id` **must** equal that segment’s `recruiter_id`.  
- **Delete segment:** only `segment_id` is nulled; `recruiter_id` stays. Bare `ON DELETE SET NULL` on a composite FK would null **all** FK columns (including NOT NULL `recruiter_id`) — rejected in static review; fixed to `SET NULL (segment_id)`.

Replace or coexist carefully with existing single-column `segment_id → crm_segments(id)` FK: prefer **drop only the old single-column FK** after adding composite (same target table), so one FK remains. Do **not** leave contradictory FKs.

### 3.3 Recipient cohesion (fixes F09 + F10)

```sql
-- Conceptual:
ALTER TABLE public.crm_campaign_recipients
  ADD CONSTRAINT crm_recipients_campaign_same_recruiter_fkey
  FOREIGN KEY (campaign_id, recruiter_id)
  REFERENCES public.crm_campaigns (id, recruiter_id)
  ON DELETE CASCADE;

ALTER TABLE public.crm_campaign_recipients
  ADD CONSTRAINT crm_recipients_contact_same_recruiter_fkey
  FOREIGN KEY (contact_id, recruiter_id)
  REFERENCES public.crm_contacts (id, recruiter_id)
  ON DELETE CASCADE;
```

Again: migrate off single-column FKs to these composites (or add composites and drop singles) so `campaign_id`/`contact_id` still reference real rows **and** share `recruiter_id`.

**Effect on F10:** Recruiter A cannot insert `(campaign_id=B’s campaign, contact_id=B’s contact, recruiter_id=A)` — composite FK to campaigns fails. Unique pair occupation against B becomes impossible without B’s `recruiter_id` (which INSERT RLS still forbids for A).

Keep `UNIQUE (campaign_id, contact_id)` as legitimate per-campaign dedupe for the **owning** tenant.

### 3.4 Optional defense-in-depth (SECURITY DEFINER)

If desired after FKs:

```text
crm_segment_owned_by(p_segment_id uuid, p_recruiter_id uuid) RETURNS boolean
crm_campaign_owned_by(...)
crm_contact_owned_by(...)
```

- `SECURITY DEFINER`, `SET search_path = public`  
- `REVOKE ALL FROM PUBLIC`; grant execute to `authenticated` only as needed  
- Use in RLS WITH CHECK **in addition to** FKs — never as the only control  

Avoid chaining these helpers in ways that re-enter the same table’s policies under invoker.

### 3.5 What stays unchanged

- SELECT policies (`recruiter_id = auth.uid() OR admin`)  
- Seeker cannot INSERT (still requires `current_role_is('recruiter')`)  
- Admin UPDATE/DELETE elevation  
- `email_delivery_events` admin-SELECT / no authenticated INSERT  
- App AuthZ in `send-campaign.server.ts` / `prepareCampaignSend` (keep as defense-in-depth)

---

## 4. How each vulnerability is prevented

| Vulnerability | Prevention after PROPOSED_0022 (proposed) |
|---|---|
| F08 foreign `segment_id` | Composite FK `(segment_id, recruiter_id)` → insert/update rejected by Postgres |
| F09 mismatched recipient graph | Composite FKs force `recruiter_id` to match both campaign and contact owners |
| F10 unique-key occupation | Without matching `recruiter_id`, foreign `campaign_id` cannot be referenced; UNIQUE remains owner-local in practice |
| Service role EF recipient updates | Still allowed; updates that change ids to break cohesion fail FK; tracking-only patches OK |
| Malicious direct Supabase INSERT | Fails at FK (+ existing RLS on `recruiter_id`) |

---

## 5. Pre-apply data validation (required)

Before adding FKs, run **read-only** validation on production (you execute; Agent must not run unless approved). If any rows fail, **fix or null out** before apply — otherwise migration fails mid-way.

### 5.1 Campaigns with foreign segments

```sql
-- Read-only diagnostic (do not run in Agent without approval):
SELECT c.id AS campaign_id, c.recruiter_id AS campaign_recruiter,
       c.segment_id, s.recruiter_id AS segment_recruiter
FROM public.crm_campaigns c
JOIN public.crm_segments s ON s.id = c.segment_id
WHERE c.segment_id IS NOT NULL
  AND c.recruiter_id IS DISTINCT FROM s.recruiter_id;
```

**Remediation options:** `UPDATE crm_campaigns SET segment_id = NULL WHERE …` (preserves campaign) or reassign segment ownership (rare).

### 5.2 Recipients with mismatched campaign owner

```sql
SELECT r.id, r.recruiter_id AS row_recruiter,
       r.campaign_id, camp.recruiter_id AS campaign_recruiter
FROM public.crm_campaign_recipients r
JOIN public.crm_campaigns camp ON camp.id = r.campaign_id
WHERE r.recruiter_id IS DISTINCT FROM camp.recruiter_id;
```

### 5.3 Recipients with mismatched contact owner

```sql
SELECT r.id, r.recruiter_id AS row_recruiter,
       r.contact_id, ct.recruiter_id AS contact_recruiter
FROM public.crm_campaign_recipients r
JOIN public.crm_contacts ct ON ct.id = r.contact_id
WHERE r.recruiter_id IS DISTINCT FROM ct.recruiter_id;
```

### 5.4 Expected clean-slate case

If CRM just went live and only happy-path UI/server writes exist, these queries likely return **0 rows** — still **must verify** before FK apply.

**Orphan / adversarial rows:** Prefer delete malicious recipient rows; null `segment_id` on bad campaigns rather than deleting campaigns with send history when possible.

---

## 6. SQL change outline (`PROPOSED_0022` — authored, not applied)

Order inside `PROPOSED_0022_crm_ownership_integrity.sql`:

1. Precondition comment: run §5 diagnostics; abort if unclean (verified empty CRM 2026-11-02).  
2. `ADD CONSTRAINT … UNIQUE (id, recruiter_id)` on segments, campaigns, contacts.  
3. Drop single-column FKs (`crm_campaigns_segment_id_fkey`, `crm_campaign_recipients_campaign_id_fkey`, `crm_campaign_recipients_contact_id_fkey`) — confirm live names before apply.  
4. Add composite FKs (§3.2–3.3).  
5. Optional SECURITY DEFINER helpers — **not included** in 0022 (FKs are primary control).  
6. No changes to RLS or `email_delivery_events` grants.  
7. Comment: register version only after successful apply; never blind `db push`.

**Not in scope of 0022:** rewriting 0021 files in place; changing HubSpot/Resend app logic (optional follow-up).

---

## 7. Rollback considerations

| Situation | Action |
|---|---|
| FK add fails (data violation) | Transaction aborts — no partial FK if wrapped in one transaction; fix data and retry |
| FK add succeeds but app regressions | Unlikely if app already sets matching `recruiter_id`; verify send + contact create |
| Need to undo 0022 | `ALTER TABLE … DROP CONSTRAINT` for new composite FKs and unique pairs; **re-add** prior single-column FKs from 0021 if dropped. Requires explicit approval. |
| Do **not** | `db reset`, drop CRM tables, or weaken SELECT policies to “fix” send |

Webhook EF updates only `tracking_status` / timestamps / `resend_email_id` — should remain compatible.

---

## 8. Test plan (two recruiters + malicious direct requests)

Implement when hardening is coded/applied (Vitest for pure logic; live/manual or integration for Postgres).

### 8.1 Unit / integration (DB or SQL test harness)

| # | Actors | Action | Expected |
|---|---|---|---|
| T1 | Recruiter A | Create segment S_a, campaign with `segment_id=S_a`, same `recruiter_id` | Success |
| T2 | Recruiter A | Insert campaign with A’s `recruiter_id` + B’s `segment_id` | **Reject** (FK) |
| T3 | Recruiter A | Update own campaign `segment_id` → B’s segment | **Reject** (FK) |
| T4 | Recruiter A | Insert recipient for A’s campaign + A’s contact | Success |
| T5 | Recruiter A JWT | Insert recipient: `recruiter_id=A`, `campaign_id=B`, `contact_id=B` | **Reject** (FK); RLS alone insufficient historically |
| T6 | Recruiter A JWT | Insert recipient: `recruiter_id=B`, … | **Reject** (RLS WITH CHECK) |
| T7 | Recruiter B | After T5 attempt, enroll same `(campaign_id, contact_id)` as B | Success (no unique poison) |
| T8 | Recruiter A | SELECT B’s contacts/campaigns | Empty / denied |
| T9 | Admin | SELECT both tenants’ CRM | Allowed |
| T10 | Seeker JWT | INSERT into `crm_contacts` | Denied |
| T11 | Service role | Update recipient tracking columns only | Success |
| T12 | Service role | Update recipient to point `campaign_id` at other tenant with wrong `recruiter_id` | **Reject** (FK) |

### 8.2 Application regression

| # | Check | Expected |
|---|---|---|
| A1 | UI create campaign + segment + confirm send | Still works |
| A2 | `prepareCampaignSend` mismatched segment | Still fails closed |
| A3 | Import contacts / HubSpot soft sync | Unaffected |
| A4 | Existing Phase 5 unit suite | Green |

### 8.3 Manual live (after apply approval)

1. Two recruiter accounts; capture campaign/segment/contact UUIDs.  
2. From browser or SQL-as-JWT, attempt T2/T5; confirm error codes (`23503` FK / RLS).  
3. Confirm B can still send to own contact.  
4. Confirm seeker still redirected from `/recruiter/crm`.

---

## 9. Application code impact (planning note only)

| Area | Expected change when implementing |
|---|---|
| Happy-path CRM writes | **None required** if they already set `recruiter_id` consistently (current send path does) |
| Any client that sets `segment_id` without matching owner | Will start failing — correct |
| Types / migrations registry | New PROPOSED_0022 file + supabase mirror when authorized |
| Audit doc | Mark F08–F10 remediated after verify |

**This planning step does not modify application code.**

---

## 10. Approval gates

| Step | Requires your explicit approval? |
|---|---|
| Run §5 validation SQL (read-only) | Recommended you run; Agent needs approval if asked to connect |
| Author `PROPOSED_0022_*.sql` in repo | Yes |
| Apply 0022 to production | Yes (separate from authoring) |
| Drop/recreate FKs / rollback | Yes |
| Phase 6 | Yes (separate); **not** part of this plan |

---

## 11. Deliverable checklist

- [x] Hardening plan document created  
- [x] Proposed SQL strategy explained (composite FKs)  
- [x] F08/F09/F10 mapped to controls  
- [x] Rollback considerations (footer of PROPOSED_0022 + §7)  
- [x] Two-recruiter / malicious request tests outlined  
- [x] Pre-apply data validation explained + executed (0 mismatch rows)  
- [x] `PROPOSED_0022` authored (drizzle + supabase mirror)  
- [x] Automated unit tests for cross-recruiter / ownership mismatch (FK mirror)  
- [ ] **Apply `PROPOSED_0022` to production** — blocked pending separate approval  
- [ ] Live JWT/SQL verification of T2/T5 after apply (§8.3)

---

## 12. Remaining live verification (after apply approval)

1. Re-run §5 diagnostics (must still be clean if data was added).  
2. Confirm live FK constraint names to drop match 0022 (or adjust).  
3. Apply `PROPOSED_0022` via SQL Editor / scoped migrate — **not** blind `db push`.  
4. Verify constraints exist: `crm_*_id_recruiter_unique`, `crm_campaigns_segment_same_recruiter_fkey`, `crm_recipients_*_same_recruiter_fkey`.  
5. Two-recruiter live attempts for T2/T5; expect Postgres `23503` (and RLS for T6).  
6. Confirm B can enroll own pair (T7); seeker still denied CRM; webhook tracking update still works (T11).  
7. Register migration history only after success; reload PostgREST schema if needed.

**STOP.** Implementation on disk only. Migration **not** applied. No Phase 6, no commit/push from this step.
