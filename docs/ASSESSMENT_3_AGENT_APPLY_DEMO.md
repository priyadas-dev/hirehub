# Assessment 3 — Agent apply end-to-end (Mode B)

Amol requires a **real write**: agent picks a job → resume available → Confirm → application row created. Mode A browser scripts skip mutating confirms by design.

## Automated evidence (2026-11-24)

Script: `node scripts/a3-mode-b-apply-only.mjs` against `https://hirehub-dev.vercel.app`

| Step | Result |
|------|--------|
| Seeker login | pass |
| Open `/seeker/assistant` | pass |
| Discovery (“find me approved IT jobs”) | pass — matching job cards returned |
| Propose (“apply to the first job”) | pass — **Confirm apply** chip visible |
| Confirm → DB write | **not finalized in headless run** — after Confirm / chat “yes confirm apply”, assistant re-listed jobs instead of returning submitted/already_applied (see [`a3-agent-apply-mode-b.json`](./a3-agent-apply-mode-b.json) + [`a3-agent-apply-mode-b.png`](./a3-agent-apply-mode-b.png)) |

Offline harness still proves confirm-gate + insert logic: `npm run rag:eval:agents` (18/18) and unit apply tests.

## Manual demo for DCT (required for mentor sign-off)

1. Sign in as Job Seeker on https://hirehub-dev.vercel.app/  
2. Ensure PDF resume on Profile (or attach in chat).  
3. `/seeker/assistant` → New chat.  
4. Ask: `find me approved IT jobs`  
5. Ask: `apply to the first job` → wait for **Confirm apply** chip.  
6. Click **Confirm apply**.  
7. Show UI success / already applied + Supabase `applications` row for `(job_id, seeker_id)`.  
8. Record that clip; link Drive folder in the submission report.

## Opt-in mutating script (local)

```bash
set E2E_BASE_URL=https://hirehub-dev.vercel.app
node scripts/a3-mode-b-apply-only.mjs
```

Do not treat Mode A `14 pass / 4 skipped` alone as E2E write evidence.
