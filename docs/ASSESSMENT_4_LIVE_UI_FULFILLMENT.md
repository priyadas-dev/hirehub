# Assessment 4 — Live UI evidence

**Intern:** Priya Das · **Product:** HireHub · **Date:** 2026-11-27  
**Live URL:** https://hirehub-dev.vercel.app/  
**Method:** Playwright against production  
**Primary Memory demo surface:** Job Seeker `/seeker/assistant`  

Credentials are shared via DCT / DM only — not recorded here.

Related: [`ASSESSMENT_4_SUBMISSION.md`](./ASSESSMENT_4_SUBMISSION.md) · [`ASSESSMENT_4_DECISION_LOG.md`](./ASSESSMENT_4_DECISION_LOG.md)  
Evidence folder: [`docs/evidence/a4-memory-smoke/`](./evidence/a4-memory-smoke/)

---

## Verdict

| Surface | Result |
|---------|--------|
| `/seeker/assistant` Memory path | **Working** — Session1 learn → Session2 recall → forget-me clears DB → colder follow-up |
| Settings forget-me (seeker + recruiter) | **Working** — UI + server delete |
| Public repo + `assessment-4` tag | **Delivered** — https://github.com/sjinnovation/hirehub/tree/assessment-4 |
| Measured README before/after | **Delivered** — tokens 412→251, personalization 50%, fidelity 4/4 |

Capstone depth is proven on the **seeker Memory path** (brief scoring: recall, compaction, governance, before/after). Recruiter Agent chat remains intentionally job-gated (owned listings required for shortlist/outreach); forget-me is available to both roles.

---

## Seeker — Session1 → Session2 → forget-me

| Step | Action | Observation | Result |
|------|--------|-------------|--------|
| Login | Seeker → `/seeker/assistant` | Job Seeker workspace | **PASS** |
| S1 learn | “I want React frontend jobs in Dhaka” | Turn completed; memory written | **PASS** |
| S2 recall | New chat — “Find jobs for me” | **2** jobs; “Matches your **React** … skills” | **PASS** |
| Forget UI | Settings → Forget my agent memory | Confirm dialog present | **PASS** |
| Forget API | Confirm | Deleted **6** sessions / **28** events / **8** semantic facts | **PASS** |
| Cold after forget | New chat — “Find jobs for me” | Broader / less personalized results | **PASS** |

Screenshots: `01-session1-learn.png` … `05-cold-start.png`.

---

## Recruiter — Settings & agent shell

| Step | Action | Observation | Result |
|------|--------|-------------|--------|
| Login | Recruiter → `/recruiter/agent` | AI Recruiter Agent page loads | **PASS** |
| Jobs gate | Agent input | Requires owned job listings (product design) | **By design** |
| Empty UX | No listings | Banner points to Post a job / Company profile | **Delivered** |
| Forget UI | `/settings` | Forget my agent memory present | **PASS** |

Screenshots: `07-recruiter-agent.png`, `08-recruiter-jobs.png`.

---

## Brief requirements

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Durable multi-layer memory; Supervisor writes | **Met** — live + schema |
| 2 | Semantic recall; side-by-side vs cold | **Met** — live S2 vs cold + offline harness |
| 3 | Compaction + token/fidelity | **Met** — README + `a4:memory-eval` |
| 4 | Governance: PII, RLS, write policy, forget-me | **Met** — live forget counts |
| 5 | Before/after in README | **Met** |
| — | Decision Log | **Met** |
| — | Write-up + demo + `assessment-4` tag | **Met** |

### Code (deployed on tagged `main`)

- Discovery broaden + early clarify — `src/lib/ai/agents/discovery.ts`
- Broaden answer note — `src/lib/ai/agents/supervisor.ts`
- Forget-me toast — `src/components/settings/ForgetAgentMemorySection.tsx`
- Recruiter empty-state — `src/routes/_app.recruiter.agent.tsx`

Unit evidence: `guardrail-confidence` + `a4-memory-layer` + `assistant-coverage` (**63** tests).

---

## Reproduce

```sh
npm test -- src/test/a4-memory-layer.test.ts
npm run a4:memory-eval
npm run a4:recall-trace
```

Live walkthrough: https://hirehub-dev.vercel.app/ as Job Seeker — Session1 → Session2 → Forget me → cold start.
