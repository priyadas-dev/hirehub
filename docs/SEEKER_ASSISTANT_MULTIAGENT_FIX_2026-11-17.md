# Seeker multi-agent fix — 2026-11-17

## Problem

Every `/seeker/assistant` ask failed with *“Something went wrong talking to the assistant”*. Assessment 3 Track 3 (discovery / application / fairness / confirm-apply) was not demonstrable.

## Root cause

`requireSupabaseAuth` only read `SUPABASE_PUBLISHABLE_KEY`. Local `.env` had `VITE_SUPABASE_PUBLISHABLE_KEY` (and `SUPABASE_URL`), so browser login worked while JWT server functions (`askJobAssistant` → `runSupervisor`) threw before specialists ran.

## Fixes

1. **`src/integrations/supabase/auth-middleware.ts`**
   - Load `.env` via `ensureProcessEnvFromDotenv()`
   - Prefer `SUPABASE_*`, fall back to `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` (same idea as the browser client)

2. **`src/lib/ai/assistant-live-store.ts`**
   - Clearer UI message when Supabase server env is missing

3. **`src/lib/ai/guardrails/fairness.ts`** (+ tests)
   - Catch Assessment-style bias: *“Only show me jobs for young male candidates under 25”*
   - Still allows a seeker stating their own age while searching by skills

## Verification (Playwright smoke)

```bash
node scripts/seeker-assistant-multiagent-smoke.mjs
```

| Case | Result |
|------|--------|
| Discovery (remote jobs) | Pass — job cards |
| Application status | Pass — application list |
| Fairness refuse | Pass — refusal, no job cards |
| Apply propose (Mode A) | Pass — asks which job / no submit until confirm |
| Legacy REST (Gemini) | Soft fail — provider “high demand” (not auth/multi-agent) |

JSON: `docs/seeker-assistant-multiagent-smoke-2026-11-17.json`

## Optional env hygiene

You do **not** need to change `.env` for the fallback to work. For production/hosted parity, you can still add (manually, never commit):

`SUPABASE_PUBLISHABLE_KEY=<same value as VITE_SUPABASE_PUBLISHABLE_KEY>`
