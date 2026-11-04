# Assessment 3 — Pre-Implementation Checklist

Complete this checklist before implementing any major HireHub Assessment 3 feature or architectural change.  
Reference: `docs/ASSESSMENT_3_ENGINEERING_RULES.md` and `.pdf_extract.txt`.

**Agent instruction:** If any box cannot be checked, stop and resolve it (or get user approval) before coding.

**Pending approvals reminder:** Integration pair, CRM model, live RAG baseline re-count / scale, and migration 0018/0019 actions remain pending unless the user has explicitly approved them for the current task. Do not treat recommendations as finalized.

## A. Rules and requirements
- [ ] Read `docs/ASSESSMENT_3_ENGINEERING_RULES.md`
- [ ] Map the task to an official A3 track / hard problem / mark
- [ ] Confirm the requirement is not already implemented
- [ ] Note any conflict with engineering rules (explain before proceeding)
- [ ] Confirm any product/architecture choice for this task is user-approved (not only recommended)

## B. Existing code inspection
- [ ] Search for existing modules/routes/tests touching this behavior
- [ ] List files to **reuse** vs files likely **new**
- [ ] Confirm we are not rebuilding auth, RLS cores, assistant shell, hybrid RAG, or classifier without documented cause

## C. Architecture and dependencies
- [ ] List upstream dependencies that must already be done
- [ ] List downstream features this will unblock
- [ ] For agents: confirm supervisor/tool/guardrail boundaries
- [ ] For CRM/integrations: confirm single source of truth decision (and that it is approved)
- [ ] Confirm CI / security-proof prerequisites if this task depends on them

## D. Security / auth / RLS
- [ ] Role checks use `profiles.role` / existing gates
- [ ] No service-role bypass for seeker apply or resume read
- [ ] RLS impact reviewed; recursion risk checked for cross-table policies
- [ ] PII / resume / fairness implications listed
- [ ] Confirm this change will not weaken authentication, RLS, or application workflows

## E. Database / migrations
- [ ] Inspect `drizzle/migrations` + `supabase/migrations` + `docs/supabase-migration-history-reconciliation.md`
- [ ] State whether DDL is required; if yes, draft additive PROPOSED only
- [ ] Confirm **no migration will be applied or repaired** without explicit user approval
- [ ] Plan history registration (not “file exists ⇒ applied”)
- [ ] Do not apply/repair 0018 or 0019 unless this task’s approval explicitly includes them

## F. Environment and secrets
- [ ] List required env vars (names only)
- [ ] Confirm no `VITE_` for server secrets
- [ ] Confirm **`.env` will not be edited** without explicit permission
- [ ] Confirm secrets will not be printed, committed, or pasted into docs

## G. RAG / embeddings / eval (if applicable)
- [ ] Confirm baseline ~5k preservation plan
- [ ] Confirm live counts re-verified or explicitly deferred with user approval
- [ ] Confirm frozen eval set usage (no template-copied queries)
- [ ] Confirm no embed overwrite / no provider-dimension mix
- [ ] Confirm bulk embed needs dry-run + explicit confirm
- [ ] Confirm no generate/delete/overwrite of corpus or embeddings without approval
- [ ] Separate retrieval vs generation metrics in acceptance criteria

## H. Tests and acceptance
- [ ] Unit/integration tests named
- [ ] Security proofs included when relevant (apply / resume / webhook / fairness)
- [ ] Definition of Done written as observable checks
- [ ] CI impact considered (workflow still green)

## I. Verification before claiming completion
- [ ] Tests run (or explicitly blocked with reason)
- [ ] Manual/demo steps listed if UI-facing
- [ ] Unverified items explicitly listed (no false “done”)
- [ ] Engineering rules updated if a new lasting decision was made
- [ ] Pending approvals still marked pending if unresolved
```