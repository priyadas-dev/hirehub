# Authentication Phase 1 — Spec lock & live verification

**Phase:** 1 of 7  
**Date:** 2026-10-29  
**Decision locked:** Option A (choose role before authentication) + harden Google claim  
**Status:** **Approved** (checks 1–5 Pass, 2026-10-29). Proceeded to Phase 2.

Companion: [`authentication-module-spec.md`](./authentication-module-spec.md)

---

## 1. Product decisions locked

| # | Decision | Locked choice |
| --- | --- | --- |
| D1 | Role selection timing | **Option A** + harden Google post-OAuth claim |
| D2 | User-driven re-role | **Delete account + re-signup** only (no self-serve switch) |
| D3 | Claim integrity approach | **Replace delete+insert** with safe UPDATE / SQL path in Phase 2 |
| D4 | Sign-in role UI | **De-emphasize on Sign in** in Phase 3; still stash role when Google can create accounts |
| D5 | Admin-assisted role change | **Allowed via admin Users UI / SQL**; not self-serve |
| D6 | Company before `/recruiter/*` | **No hard gate** — soft gate on job posting |
| D7 | Email confirmation in production | **Do not change in app code** — confirm Supabase Auth setting manually |

---

## 2. Environment verification (local `.env`)

Run: `node scripts/auth-phase1-verify.mjs`

| Check | Result (2026-10-29) |
| --- | --- |
| Project | `munqgybiuqpncxbgfvdp.supabase.co` |
| `SUPABASE_URL` / `VITE_SUPABASE_URL` | Present |
| Publishable / anon key | Present |
| `SUPABASE_SERVICE_ROLE_KEY` | Present (required for Google recruiter claim + account delete) |

**Hosted note:** Vercel/Lovable must also have `SUPABASE_SERVICE_ROLE_KEY` (server-only). Local `.env` does not configure production.

---

## 3. Live data inventory (API)

| Metric | Value |
| --- | --- |
| Auth users | 20 |
| Profiles | 20 |
| Orphan auth users (no profile) | **0** |
| Profiles missing auth user | **0** |
| Roles | `job_seeker` 13 · `recruiter` 6 · `admin` 1 |
| Google + seeker | 9 |
| Google + recruiter | 3 |

**Interpretation**

- Profile ↔ auth linkage looks healthy (no orphans).
- Google recruiter claim has succeeded for at least some accounts (3 Google recruiters).
- Google seekers (9) are **not** automatically “failed recruiter claims” — most are intentional seekers. One Google seeker was created ~minutes before this check; if that signup intended Recruiter, treat as a candidate stuck-role case for Phase 2.

PII-bearing machine output (if regenerated) is written to `docs/authentication-phase-1-verify-result.json` and is **gitignored**.

---

## 4. SQL checks you must run (Dashboard)

Supabase → **SQL Editor** → run each query. Record Pass/Fail below.

### 4.1 Migration `0001` — signup role choice

```sql
select pg_get_functiondef('public.handle_new_user()'::regprocedure) as def;
```

**Pass if** the function body contains:

`raw_user_meta_data->>'requested_role' = 'recruiter'`

### 4.2 Migration / patch `0007` — role guard bootstrap

```sql
select pg_get_functiondef('public.protect_profile_role()'::regprocedure) as def;
```

**Pass if** the body allows role changes when `auth.uid() IS NULL` (service role / SQL Editor), matching `drizzle/migrations/PROPOSED_0007_bootstrap_admin_role_guard.sql`.

**Fail if** it only allows `current_role_is('admin')` with no `auth.uid() IS NULL` branch — Phase 2 must still fix claim without relying on bare UPDATE.

### 4.3 Optional: service-role UPDATE smoke (safe on a throwaway test user only)

Do **not** run against a real production user unless intentional. Prefer Phase 2’s dedicated claim function.

### 4.4 Auth URL allowlist (Dashboard UI, not SQL)

**Authentication → URL configuration** should include (at least):

| Purpose | Example |
| --- | --- |
| Google / email return | `http://localhost:8080/auth` (and other local ports you use) |
| Deployed return | `https://YOUR_HOST/auth` |
| Password reset | `http://localhost:8080/reset-password` + deployed `/reset-password` |

Also: **Authentication → Providers → Google** enabled with matching Client ID/Secret.

**Authentication → Providers → Email → Confirm email:** note On/Off for D7 (no app change in Phase 1).

---

## 5. Phase 1 acceptance

| Criterion | Status |
| --- | --- |
| Option A + D1–D7 locked in writing | Done (this doc + spec update) |
| Local env keys present for claim path | Done |
| Live profile/role inventory | Done |
| SQL confirm `handle_new_user` (0001) | **You** — checklist below |
| SQL confirm `protect_profile_role` (0007) | **You** — checklist below |
| Redirect URL allowlist on Dashboard | **You** — checklist below |
| Confirm email setting noted | **You** — checklist below |

Phase 1 is **complete for agent work** once you finish the Test checklist and reply with Pass/Fail. Phase 2 (claim integrity) starts after that.

---

## 6. What to test / confirm (before Phase 2)

Please run these and reply with results (Pass / Fail / N/A + short note):

1. **SQL 4.1** — `handle_new_user` includes `requested_role` recruiter branch.  
2. **SQL 4.2** — `protect_profile_role` matches PROPOSED_0007 (or note if still old).  
3. **Redirect URLs** — localhost (your port) `/auth` and `/reset-password` allowlisted; production host too if you use it.  
4. **Google provider** — enabled in Supabase Auth.  
5. **Confirm email** — On or Off? (record only).  
6. **Optional smoke:** Sign up a **throwaway** email as Recruiter → land on `/recruiter` (or confirm-email path).  
7. **Optional smoke:** If safe, Google signup as Recruiter with a **new** Google account → expect `/recruiter` (documents current claim reliability before Phase 2).  
8. **Stuck-role check:** If any Google user who meant to be recruiter is still a seeker, list their email privately (do not paste secrets); we can fix in Phase 2 / admin.

When you confirm the checklist (especially items 1–5), say **Phase 1 approved** and I will start **Phase 2**.
