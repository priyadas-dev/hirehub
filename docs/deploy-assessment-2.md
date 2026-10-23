# Deploy HireHub Assessment 2 (same-day checklist)

Do **not** apply proposed SQL or deploy until you explicitly approve each step.

## Prerequisites

- [ ] Local `npm test` and `npm run build` green
- [ ] `npm run rag:eval -- --provider=gte` and `npm run rag:classify` refreshed
- [ ] `.env` has real `SUPABASE_*`, `GEMINI_API_KEY`, `EMBEDDING_PROVIDER=gte` (never commit)
- [ ] You have admin access to Supabase HireHub + Vercel (or Lovable host)

## Proposed migrations still requiring approval

Apply in SQL Editor (or migration runner) **only after review**, preferably after a staging dry-run:

| Order | File | Purpose | Ready after your approve? |
|------:|------|---------|---------------------------|
| 1 | `PROPOSED_0012_job_skill_match_notifications.sql` | Skill-match notify on approve | Yes |
| 2 | `PROPOSED_0013_auto_close_expired_jobs.sql` | service_role expiry close + RPC | Yes |
| 3 | `PROPOSED_0014_job_closed_reason.sql` | `closed_reason` + stamp expiry + recruiter reopen RPC | Yes (after 0013) |

Already assumed live: notifications (`0005`/`0006b`), `profiles.skills` (`0009`), corpus + gte (`0010`/`0011`), deadline (`0002`).

**Recruiter reopen:** job details → “Extend deadline & reopen” when `closed_reason = expired_deadline` (requires 0014).

### After applying 0012

1. Ensure ≥1 seeker has `profiles.skills` with known skills (e.g. `React, SQL`).
2. Admin-approve a pending job whose title/description mentions those skills.
3. Matching seeker sees `job_skill_match`; non-matching does not; recruiter still gets `job_approved`.
4. Re-approve/reopen → no duplicate skill-match row (dedupe).

### After applying 0013, then 0014, then deploying Edge Function

1. Apply **0013**, then **0014** (0014 replaces close RPC + `protect_job_status` again with reopen branch).
2. Deploy function: `supabase functions deploy close-expired-jobs`
3. Set secret `CRON_SECRET` (≥16 chars) on the function / project.
4. Schedule daily invoke (Dashboard → Edge Functions → Schedules):
   - Method: **POST**
   - Cron: e.g. `15 18 * * *` (18:15 UTC ≈ 00:15 Asia/Dhaka)
   - Header: `x-hirehub-cron-secret: <CRON_SECRET>`
   - Body: `{}`
5. Smoke auto-close → `closed` + `closed_reason=expired_deadline` + recruiter notify.
6. Smoke recruiter **Extend deadline & reopen** on job details; confirm manual-close jobs do not get that control.

**Note:** HireHub has **no `pg_cron`** today; scheduling is Edge Function cron / external POST only.

**Note:** service_role path is JWT-role gated + past-deadline only (not a client GUC).

## Vercel / host deploy

1. Import repo; framework `tanstack-start` (`vercel.json`).
2. Set env (Production + Preview):

| Variable | Client? |
|----------|---------|
| `VITE_SUPABASE_URL` | Yes |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Yes |
| `SUPABASE_URL` | Server |
| `SUPABASE_PUBLISHABLE_KEY` | Server |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only |
| `GEMINI_API_KEY` | Server only |
| `EMBEDDING_PROVIDER=gte` | Server |
| `RESEND_*` / contact mail | Optional |

3. Add Auth redirect URLs for the deployed origin (`/auth`, `/reset-password`) in Supabase.
4. Deploy → paste URL into `docs/assessment-2-verification.md` and README evidence table.
5. Manual browser checklist (assistant + both automations + screenshots/Loom).

## Playwright (optional local)

```sh
npx playwright install chromium
# local only — never commit:
# E2E_SEEKER_EMAIL=... E2E_SEEKER_PASSWORD=... E2E_BASE_URL=http://127.0.0.1:8080
npm run dev   # separate terminal
npm run test:e2e
```

Without credentials the suite **skips** (exit 0).

## Do not

- Force-push / rewrite Lovable-connected history
- Commit `.env`, service role keys, `CRON_SECRET`, or E2E passwords
- Reseed or overwrite the 5,000 `embedding_gte` vectors
- Apply proposed SQL without approval
