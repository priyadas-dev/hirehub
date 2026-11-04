# HireHub Assessment 3 — Phase 5 Report (Thin CRM)

**Phase:** 5 only  
**Date:** 2026-11-02  
**Branch:** `feature/auth-module-phases-1-7`  
**Rules followed:** engineering rules, checklist, roadmap, integration contracts, Phase 4 report, project-guardian  

**Mutation statement:** No `.env` edits, no migration apply/`db push`, no existing RLS weaken, no RAG mutate, no commit/push, Phase 6 not started. `PROPOSED_0020` / `PROPOSED_0021` are on disk only.

---

## 1. Understanding

Build HireHub CRM inside the existing Recruiter workspace: contacts, segments (`new|active|placed`), campaigns with preview + explicit confirm send via Resend, webhook tracking, optional HubSpot sync ids — HireHub remains in-app SoT.

---

## 2. Decision

| Approach | Chosen? | Why |
|---|---|---|
| HubSpot as primary CRM UI | No | Forbidden dual SoT |
| Rebuild applicants into CRM | No | Keep applicants; CRM is additive |
| Apply migrations in this phase | No | Requires separate explicit approval |
| **Additive `PROPOSED_0021` + domain libs + `/recruiter/crm` UI + Phase 4 Resend/HubSpot/Svix reuse** | **Yes** | Matches contracts; ownership via denormalized `recruiter_id` RLS (no cross-table EXISTS recursion) |

### Pre-implementation checklist (completed)
- Rules/contracts/roadmap read; Track 2 mapped  
- Phase 4 integrations reused (not rebuilt)  
- CRM SoT = HireHub (approved)  
- DDL = additive PROPOSED only; **not applied**  
- Secrets: names only; `.env` not edited  
- CI: unit tests expanded; workflow unchanged  

---

## 3. Implementation

### Schema (unapplied)
| File | Purpose |
|---|---|
| `drizzle/migrations/PROPOSED_0021_crm_tables.sql` | `crm_contacts`, `crm_segments`, `crm_campaigns`, `crm_campaign_recipients` + owner RLS; extends `email_delivery_events.campaign_recipient_id` when 0020 present |
| `supabase/migrations/20261102130000_proposed_0021_crm_tables.sql` | Mirror |

Duplicate prevention: `UNIQUE (recruiter_id, email_normalized)` on contacts.  
Send idempotency: unique `send_idempotency_key` on campaigns + recipients.

### Domain / integrations
| Area | Files |
|---|---|
| Types / ownership / contacts / segments / campaigns | `src/lib/crm/*` |
| Memory store (tests) | `src/lib/crm/memory-store.ts` |
| Supabase adapters + schema probe | `supabase-crm.ts`, `schema-probe.ts` |
| Resend campaign mail | `campaign-mail.ts` |
| Send createServerFn | `send-campaign.server.ts` |
| Soft HubSpot sync | `hubspot-contact-sync.ts`, `sync-contact.server.ts` |
| Webhook correlation | Extended Phase 4 `resend-webhook` (+ EF) for `campaign_recipient_id` tags |

### UI (existing shell)
| Route | Role |
|---|---|
| `/recruiter/crm` | Dashboard (counts + activity) |
| `/recruiter/crm/contacts` | Create/search/import from applicants |
| `/recruiter/crm/segments` | Create/manage segments + audience size |
| `/recruiter/crm/campaigns` | List/create drafts |
| `/recruiter/crm/campaigns/$campaignId` | Edit, preview, confirm-send, tracking |

Nav: **CRM** item in `src/components/shell/nav.ts`.

When schema missing: EmptyState explaining PROPOSED_0020/0021 must be applied (honest probe).

---

## 4. Protected areas

- `.env` / secret values  
- Existing applications/jobs/notifications RLS  
- Applicants pipeline unchanged  
- No Phase 6 agents  
- No commit/push  

---

## 5. Verification

| Check | Result |
|---|---|
| `npm test` (full) | **531 passed** / 67 files |
| `src/test/crm-phase5.test.ts` | Ownership, dupes, segments, send idempotency, webhook replay, HubSpot soft-fail |
| Phase 4 webhook tests | Still green |
| App routing includes `/recruiter/crm*` | Green |
| `.env` modified? | **No** |
| Migrations applied? | **No** |

---

## 6. Risks / limitations

1. **Live CRM persistence** needs approved apply of `PROPOSED_0020` + `PROPOSED_0021` and PostgREST schema reload.  
2. Without Resend/HubSpot secrets, send/sync soft-skip (`provider_not_configured`).  
3. HubSpot custom properties (`hirehub_crm_contact_id`, etc.) may need portal setup.  
4. `replied` / `applied` tracking remain manual or future linkage (contracts).  
5. Generated `Database` types do not yet include CRM tables — adapters use loose `from("crm_*")` until types regenerated after apply.  
6. Edge Function deploy still manual.

---

## 7. Next step

**STOP.** Await approval before **Phase 6** (multi-agent / supervisor).

Manual when ready:
1. Approve & apply `PROPOSED_0020` then `PROPOSED_0021`.  
2. Ensure host secrets: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET`, `HUBSPOT_ACCESS_TOKEN`.  
3. Deploy updated `resend-webhook` EF; point Resend webhook URL.  
4. Demo path: Recruiter → CRM → Contacts → Segments → Campaign → preview → confirm send → open tracking.
