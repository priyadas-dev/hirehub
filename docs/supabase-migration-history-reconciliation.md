# Supabase migration-history reconciliation (READ-ONLY diagnosis)

**Project:** `munqgybiuqpncxbgfvdp`  
**Date:** 2026-10-29  
**Status:** Investigation only — **no repair / push / pull / DDL executed**  
**Branch:** `fix/google-oauth-signup-role` (uncommitted work present; preserve)

---

## 1. Diagnosis (summary)

The linked project’s `supabase_migrations.schema_migrations` and the local `supabase/migrations/` directory are **out of sync in both directions**:

| Side | Versions |
| --- | --- |
| **Remote only** (9) | `20261011113947`, `20261011113955`, `20261011114001`, `20261011114010`, `20261013190913`, `20261013190942`, `20261013190949`, `20261013191044`, `20261023143604` |
| **Both** | `20261013191020` … `20261014090010` (proposed_0006 pointer + 0007–0016) |
| **Local only** | `20261029120000` (`proposed_0019_claim_oauth_recruiter_role`) |

**Root cause:** Early schema and several PROPOSED patches were applied via **Dashboard / Lovable / SQL Editor** (or CLI apply that never left matching files in this repo). Later, `scripts/_register_migration_history.sql` backfilled **different** version IDs (`2026101409000x`) for 0006–0016. `PROPOSED_0017` was applied on **2026-10-23** and recorded remotely as `20261023143604`, but the SQL lives only under `drizzle/migrations/` (never copied into `supabase/migrations/`). Migration **0019** exists locally and is **not** applied remotely; the function `claim_oauth_recruiter_role` is **missing**.

That is why `db pull` / `db push --dry-run` fail: CLI requires a 1:1 local↔remote version set.

---

## 2. Evidence

### 2.1 Config

- `supabase/config.toml` → `project_id = "munqgybiuqpncxbgfvdp"` (matches).

### 2.2 `npx supabase migration list --linked` (JSON, 2026-10-29)

Remote-only rows have `"local":""`. Local-only 0019 has `"remote":""`. Matched rows list both.

### 2.3 Local `supabase/migrations/` (12 files)

```
20261013191020_proposed_0006_reviews_and_revisions.sql
20261014090001 … 20261014090010  (0007–0016)
20261029120000_proposed_0019_claim_oauth_recruiter_role.sql
```

**Missing from this folder (but present in drizzle):** `PROPOSED_0017`, `PROPOSED_0018`, and core `0000`–`0003` / `0004`–`0005` / `0006a`–`0006b`.

### 2.4 Registration script

`scripts/_register_migration_history.sql` inserts versions `20261013191020` and `20261014090001`–`010` only. It does **not** mention any of the nine remote-only versions, nor 0017/0018/0019.

### 2.5 Git history

| Finding | Evidence |
| --- | --- |
| No commit ever added files named `20261011113947*`, `20261013190913*`, or `20261023143604*` | `git log -S"20261011113947"` / similar → empty |
| `PROPOSED_0017` added **2026-10-23 20:39:52 +0600** | commit `2c03ef4` → `drizzle/migrations/PROPOSED_0017_fix_jobs_applications_rls_recursion.sql` |
| Remote `20261023143604` = **2026-10-23 14:36:04 UTC ≈ 20:36 +0600** | ~4 minutes before that commit message time — Dashboard apply of 0017 is the best match |
| Core / deadline SQL lived in **drizzle** from Oct 7–9; Lovable update Oct 10 | commits `638883b`, `a9d6d89`, `9a0b4f9`, `4bd8c92` |

**Conclusion on the nine remote versions:** They are **not** renamed copies of current local filenames. They are almost certainly **Dashboard/CLI applies** whose SQL either lived only in drizzle, or was generated/applied outside this `supabase/migrations` tree. Fabricating full historical SQL to “match” them is unnecessary and risky; **stub marker files** (comment-only) are the safe sync approach.

### 2.6 Live DB probes (read-only JS, no DDL)

Script: `scripts/auth-phase2-db-readonly-probe.mjs`

| Probe | Result |
| --- | --- |
| `claim_oauth_recruiter_role` | **RPC_MISSING** (`PGRST202`) — **0019 not applied** |
| `seeker_has_applied_to_job` | **Callable** (`data: false` for dummy UUID) — **0017 effects present** |
| `profiles.role`, `jobs.closed_reason`, `profiles.skills`, `job_corpus`, `notifications` | Present |
| `search_job_corpus_fts` | **RPC_PRESENT** — **PROPOSED_0018 effects appear live**, but **no** matching `supabase/migrations` file and **no** obvious remote version in the nine-or-matched list (Dashboard-applied / untracked history gap) |

---

## 3. Mapping: remote versions → likely content

| Remote version | Likely meaning | Confidence |
| --- | --- | --- |
| `20261011113947` … `20261011114010` (4×) | Early live schema (core / enums / baseline RLS / deadline-era) applied via Lovable/Dashboard around Oct 11 — counterparts in `drizzle/migrations/0000`–`0003` (+ related) | Medium (time cluster; no exact filename) |
| `20261013190913`, `90942`, `90949` | Likely `PROPOSED_0004`, `0005`, `0006a` (or similar) applied via SQL Editor Oct 13 | Medium |
| `20261013191020` | Local pointer file `proposed_0006_reviews_and_revisions` (comments only) + registered | High (file exists) |
| `20261013191044` | Likely `PROPOSED_0006b` (or final reviews/revisions apply) seconds after 91020 | Medium |
| `20261014090001`–`010` | proposed_0007–0016 via register script / matched local files | High |
| `20261023143604` | **`fix_jobs_applications_rls_recursion` / PROPOSED_0017** | **High** (time + `seeker_has_applied_to_job` live) |
| `20261029120000` | proposed_0019 claim RPC — **local only, not remote, function absent** | High |

**Dashboard name check:** If Supabase Dashboard shows a migration named like `fix_jobs_applications_rls_recursion` (or similar) with version/time **2026-10-23 14:36:04**, that **is** `20261023143604`. The live function `seeker_has_applied_to_job` confirms the **effects** of 0017 are already in the database.

---

## 4. State of migration 0019 / `claim_oauth_recruiter_role`

| Check | State |
| --- | --- |
| Local SQL file | Present (`supabase/migrations/20261029120000_…` and drizzle twin) |
| Remote migration history | **Not recorded** |
| Live function | **Does not exist** (PostgREST schema cache) |

→ 0019 must still be **applied** (SQL Editor or carefully scoped push after history sync). Do **not** mark it applied until the function exists.

---

## 5. Recommended recovery (preserves data / RLS / uncommitted work)

### Principles

1. **Do not** `db reset`, force-push schema, or `repair --status reverted` on the nine remote versions (that would invite re-applying unknown SQL).
2. **Do not** invent full historical SQL for the nine versions.
3. **Do not** run a blind `db push` that might try to re-apply anything already live.
4. Preserve all current uncommitted files; only **add** marker files + apply 0019 once history matches.

### Phase A — Align history (local stubs for remote-only versions)

Create **nine comment-only** files under `supabase/migrations/` with **exact** version prefixes:

```text
supabase/migrations/20261011113947_remote_baseline_1.sql
supabase/migrations/20261011113955_remote_baseline_2.sql
supabase/migrations/20261011114001_remote_baseline_3.sql
supabase/migrations/20261011114010_remote_baseline_4.sql
supabase/migrations/20261013190913_remote_proposed_patch_a.sql
supabase/migrations/20261013190942_remote_proposed_patch_b.sql
supabase/migrations/20261013190949_remote_proposed_patch_c.sql
supabase/migrations/20261013191044_remote_proposed_patch_d.sql
supabase/migrations/20261023143604_proposed_0017_fix_jobs_applications_rls_recursion.sql
```

Each file body should be **comments only**, e.g.:

```sql
-- HISTORY MARKER ONLY — already applied on remote munqgybiuqpncxbgfvdp.
-- Do not re-run. See docs/supabase-migration-history-reconciliation.md.
-- Suspected counterpart: … (drizzle path if known)
```

For `20261023143604`, point at `drizzle/migrations/PROPOSED_0017_fix_jobs_applications_rls_recursion.sql` and note effects already live (`seeker_has_applied_to_job`).

**Optional but recommended:** Also add a **local-only marker** is unnecessary for remote; instead after stubs exist, `migration list` should show all nine as Local+Remote.

**Do not** run `migration repair` for these nine if stub files make list match — repair is for when you need to flip applied/reverted without files.

### Phase B — Confirm list is clean

```bash
npx supabase migration list --linked
```

Expect: every remote version has a local counterpart; `20261029120000` still Local-only (pending).

### Phase C — Apply **only** 0019 (preferred: SQL Editor)

1. In Dashboard SQL Editor, run the full contents of  
   `drizzle/migrations/PROPOSED_0019_claim_oauth_recruiter_role.sql`  
   (same as `supabase/migrations/20261029120000_…`).
2. Run verification queries (below).
3. Record history **without re-running SQL**:

```bash
npx supabase migration repair --status applied 20261029120000
```

(`repair --status applied` only inserts a history row; it does not execute the migration file.)

### Phase C′ — Alternative: CLI push of a single pending migration

Only after Phase A stubs exist and `migration list` shows **only** `20261029120000` as pending:

```bash
npx supabase db push --linked --dry-run
# Confirm the dry-run mentions ONLY 20261029120000
npx supabase db push --linked
```

Abort if dry-run lists anything else.

### Phase D — Do **not** auto-apply in this pass

- `PROPOSED_0018` (FTS) — **function already live** but not in CLI history; do **not** re-apply SQL. Optional later: add a dated history marker + `repair --status applied` **only after** confirming Dashboard has no version and you pick a new unused version id (separate approval).
- Re-running 0000–0017 SQL — forbidden; already reflected in DB.

### Out of scope / avoid

| Action | Why avoid |
| --- | --- |
| `db pull` before stubs | Still fails / may invent conflicting migrations |
| `migration repair --status reverted` on the nine | Risks treating live schema as “not applied” |
| `db reset` | Destroys production data |
| Editing / deleting existing uncommitted migrations | Loses work |
| Pushing all pending drizzle PROPOSED files via CLI | May conflict with already-applied Dashboard state |

---

## 6. Verification queries (run in SQL Editor)

### 6.1 History inventory

```sql
select version, name, created_by
from supabase_migrations.schema_migrations
order by version;
```

**Expect:** Includes the nine remote versions + `20261013191020` + `20261014090001`–`010`. After Phase C repair: also `20261029120000`.

### 6.2 Confirm 0017 effects (Dashboard name ↔ `20261023143604`)

```sql
select proname, prosecdef
from pg_proc
join pg_namespace n on n.oid = pg_proc.pronamespace
where n.nspname = 'public'
  and proname = 'seeker_has_applied_to_job';

select polname, pg_get_expr(polqual, polrelid) as using_expr
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'jobs'
  and pol.polname = 'seeker reads jobs they applied to';
```

**Expect:** Function exists (`prosecdef = true`). Policy `USING` calls `seeker_has_applied_to_job(id)` (not raw `EXISTS` into `applications`).

### 6.3 Confirm 0019 **before** apply

```sql
select proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and proname = 'claim_oauth_recruiter_role';
```

**Expect now:** **0 rows**.

### 6.4 Confirm 0019 **after** apply

```sql
select proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and proname = 'claim_oauth_recruiter_role';

-- privileges: service_role should execute; authenticated/anon should not
select grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name = 'claim_oauth_recruiter_role';
```

**Expect:** 1 function row; `EXECUTE` for `service_role` (and not broadly for `anon`/`authenticated`).

Optional RPC smoke (service role): call with a non-existent UUID → status `profile_missing` or `user_missing` (not “function not found”).

### 6.5 Optional: 0018 FTS (informational)

```sql
select proname from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and proname = 'search_job_corpus_fts';
```

**If 0 rows:** 0018 not applied — leave alone during auth reconciliation.

---

## 7. Exact command sequence (after your approval)

```bash
# 0) Stay on current branch; commit or stash only if YOU choose — do not discard work
git status

# 1) Add nine HISTORY MARKER files (comment-only) with exact version prefixes listed in Phase A
#    (agent can create these after approval — no DDL)

# 2) Re-check alignment
npx supabase migration list --linked

# 3) Apply 0019 SQL in Dashboard (preferred) OR dry-run then push ONLY 0019
npx supabase db push --linked --dry-run
# must show only 20261029120000

# If using Dashboard SQL for 0019:
npx supabase migration repair --status applied 20261029120000

# 4) Verify with §6 queries +:
node scripts/auth-phase2-db-readonly-probe.mjs
# claim_oauth_recruiter_role interpretation → RPC_PRESENT
```

---

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| Stub files accidentally contain executable SQL that re-creates objects | Comments only; review diffs |
| `db push` applies unexpected migrations | Dry-run gate; abort unless only 0019 |
| `repair --status applied` without running SQL | Always verify function exists first |
| `repair --status reverted` on remote-only | **Do not** — would desync worse |
| Confusing drizzle vs supabase trees | Treat `supabase/migrations` as CLI source of truth; drizzle remains design archive |
| Uncommitted auth work lost | Do not reset branch; only add marker files + docs |

---

## 9. Approval gate

**Stopped here.** No migration files were added/removed for reconciliation (aside from this diagnosis doc / optional probe script). No `repair`, `push`, `pull`, or 0019 DDL was run.

Please approve **one** of:

1. **Plan A (recommended):** Create nine comment-only stubs → verify `migration list` → apply 0019 via SQL Editor → `migration repair --status applied 20261029120000`.  
2. **Plan A′:** Same stubs → `db push --dry-run` (0019 only) → `db push --linked`.  
3. **Defer** stubs; apply 0019 via SQL Editor only (Dashboard will show function; CLI history remains mismatched until stubs/repair later).

Reply with **1**, **2**, or **3** (or adjustments) before any execution.
