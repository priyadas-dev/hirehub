# Assessment 3 Track 6 — CI, observability & security

**Branch context:** implemented on `multi-agent` (Phase 1)  
**Date:** 2026-11-10  
**Guardian:** no `.env` edits, no schema/RLS changes, no migration apply, no secrets committed

---

## 1. CI / CD (GitHub Actions)

| Item | Status |
|------|--------|
| Workflow | `.github/workflows/ci.yml` |
| Job | `npm ci` → `npm test` with `CI=true` (no prod secrets) |
| Triggers | `pull_request` + push to `main`, `master`, `multi-agent`, `assessment-3-integration`, `feature/resend-crm-integration`, `feature/hirehub-google-calendar-integration` |

**How to capture the green link for DCT**

1. Commit + push this Track 6 work to `multi-agent` (or your integration branch).  
2. Open GitHub → **Actions** → workflow run for that commit.  
3. Paste the green run URL into Dev Control Tower evidence.

Until pushed, CI cannot show green on GitHub even if local `npm test` passes.

---

## 2. Observability (Sentry)

| Item | Detail |
|------|--------|
| Packages | `@sentry/node`, `@sentry/react` |
| Module | `src/lib/observability/sentry.ts` |
| Server hook | `src/server.ts` — init + capture on SSR 500 paths |
| Browser hook | `src/routes/__root.tsx` — init + root error boundary capture |
| Default | **No-op** when DSN missing (safe for local/CI) |
| PII | `sendDefaultPii: false` + redaction of Bearer/JWT/`api_key`-like strings |

### Manual env (you set — agent does not edit `.env`)

| Variable | Where | Notes |
|----------|--------|------|
| `SENTRY_DSN` | Server host secrets (Vercel / local `.env`) | Server-only |
| `VITE_SENTRY_DSN` | Frontend env (optional) | Public DSN only — not a secret token |

**Live evidence (2026-11-24):** DSN set locally + Vercel (redeployed). Smoke event marker `hirehub-a3-sentry-smoke-2026-11-24T06:25:04.122Z`. Screenshot: [`a3-sentry-event-screenshot.png`](./a3-sentry-event-screenshot.png). See [`ASSESSMENT_3_SENTRY_EVIDENCE.md`](./ASSESSMENT_3_SENTRY_EVIDENCE.md).

---

## 3. AI match rate-limit + cache

| Item | Detail |
|------|--------|
| Module | `src/lib/ai/ai-match-guard.ts` |
| Wired in | `askJobAssistant` server fn (rate limit) + `listLiveJobs` (30s TTL cache) |
| Defaults | 20 requests / 60s / user; cache TTL 30s; max 200 entries |
| Failure mode | Friendly `rate_limited` result — no stack leak |
| Scope | Process-local (expected for single Node / warm isolate) |

Unit tests: `src/test/ai-match-guard.test.ts`.

---

## 4. Security advisor pass (read-only)

### 4.1 Live hosted checks (read-only, 2026-11-10)

Project: **HireHub** `munqgybiuqpncxbgfvdp` (production). No writes.

| Check | Command / source | Result |
|-------|------------------|--------|
| `db lint --linked` | plpgsql warnings only on `public.extract_known_skills` (text→text[] cast / shadowed loop var) | **No critical security lint** — leftover function style warnings; **not fixed** in Phase 1 (out of scope; needs separate approval) |
| `storage.buckets` | `resumes.public = false`, `company-logos.public = false` | **PASS (live)** |
| Resume Storage policies | `resumes_select_owner_admin_or_hiring_recruiter` + seeker own INSERT/UPDATE/DELETE | **PASS (live)** |

**Dashboard screenshot for DCT:** see [`a3-security-advisor-pass.md`](./a3-security-advisor-pass.md). Supabase → **Advisors** → Security. Do **not** “fix” by making `resumes` public. Any RLS change needs explicit approval. Re-verified live bucket + policies 2026-11-24.

### 4.2 Static / code evidence (resume focus)

| Check | Evidence | Result |
|-------|----------|--------|
| Resume bucket private | `PROPOSED_0008` + live query above | **PASS** |
| Resume SELECT policy | Live `pg_policies` + migration | **PASS** |
| App authorize-before-sign mirror | `src/lib/resume-access.ts` + `src/test/resume-access-rls.test.ts` | **PASS (unit)** |
| Live JWT denial matrix | `npm run a3:resume-deny` (+ Track 3 resume ACL doc) | **SCRIPT READY** — run with two recruiter JWTs; screenshot for DCT |
| Service-role / secrets in `VITE_` | Integrations use non-`VITE_` names (`src/lib/integrations/env.ts`) | **PASS (pattern)** |
| AI match endpoint AuthZ | `askJobAssistant` uses `requireSupabaseAuth` + profile role | **PASS** |

### 4.3 Known residual (do not “fix” without approval)

- CRM cross-tenant INSERT cohesion gaps exist on the CRM branch audit (app-layer mitigated on send). Not changed in Phase 1.  
- Live Storage denial still needs the 3-JWT matrix write-up (Phase 3 proof polish).  
- Durable `agent_sessions` (`PROPOSED_0027`) is **live applied** (verified 2026-11-24) — see [`ASSESSMENT_3_MIGRATION_STATUS.md`](./ASSESSMENT_3_MIGRATION_STATUS.md).

---

## 5. Verification performed in Phase 1

| Check | Result |
|-------|--------|
| `vitest` — `ai-match-guard`, `sentry-observability`, `ask-job-assistant-supervisor`, `resume-access-rls` | **21 passed** |
| `npm run build` (client + SSR) | **Success** (2026-11-10) |
| GitHub Actions green URL | Publish per [`ASSESSMENT_3_AMOL_GAP_CLOSEOUT.md`](./ASSESSMENT_3_AMOL_GAP_CLOSEOUT.md) — open Actions → paste green CI run into DCT + submission report |

---

## 6. What Phase 1 deliberately did **not** do

- Edit `.env` / print secrets  
- Apply migrations or change RLS  
- Merge CRM branch (Phase 0 — still recommended separately)  
- Wire HubSpot or CRM `replied`/`applied` automation (Phase 2)  
- Force-push / rewrite Lovable history  
