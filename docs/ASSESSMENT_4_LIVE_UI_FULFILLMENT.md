# Assessment 4 — Live UI fulfillment report

**Intern:** Priya Das · **Product:** HireHub · **Date:** 2026-11-27  
**Live URL:** https://hirehub-dev.vercel.app/  
**Method:** Playwright MCP against production (user-side)  
**Roles tested:** Job Seeker · Recruiter  

**Credentials:** used for this run only; **not recorded here**. Share via DCT / DM. Rotate if exposed in chat.

Related: [`ASSESSMENT_4_SUBMISSION.md`](./ASSESSMENT_4_SUBMISSION.md) · [`ASSESSMENT_4_DEMO_SCRIPT.md`](./ASSESSMENT_4_DEMO_SCRIPT.md) · [`ASSESSMENT_4_DECISION_LOG.md`](./ASSESSMENT_4_DECISION_LOG.md)  
Evidence folder: [`docs/evidence/a4-memory-smoke/`](./evidence/a4-memory-smoke/)

---

## Verdict (short)

| Surface | Working well? | A4 Memory proof |
|---------|---------------|-----------------|
| `/seeker/assistant` | **Yes** — chat, history, job cards | **Mostly yes** — learn → warmer recall → forget clears DB → colder results |
| `/recruiter/agent` | **Page loads; input disabled** | **Not proven on live for this recruiter** — **0 job posts**, chips/input require jobs |
| Settings forget-me | **Yes** (seeker + recruiter) | **Yes** — server deleted sessions/events/semantic |

**Overall A4 product layer:** Memory depth is **implemented and partially proven live on seeker**. Capstone **submit pack** (demo video + `assessment-4` tag) is still incomplete. Recruiter agent memory path needs a recruiter account **with owned jobs** to exercise end-to-end.

---

## What we ran (seeker)

| Step | Action | Observation | Result |
|------|--------|-------------|--------|
| Login | Seeker → `/seeker/assistant` | Landed Job Seeker workspace | **PASS** |
| S1 learn | New chat: “I want React frontend jobs in Dhaka” | Reply + history item; first reply was weak (“synthetic career context”) | **PASS** (turn ran) · reply quality weak |
| S2 recall | New chat: “Find jobs for me” | **2** approved jobs; copy “Matches your **React** … skills” — did **not** re-ask skills | **PASS** (personalization signal) |
| Forget UI | Settings → Forget my agent memory | Section + confirm dialog present | **PASS** |
| Forget API | Confirm “Yes, forget me” | `_serverFn` **200**; deleted **sessions=6, events=28, semantic=8**; second call **0/0/0** | **PASS** (toast not reliably visible) |
| Cold after forget | New chat: “Find jobs for me” | **8** broader jobs; less React-specific framing than S2 | **PASS** (contrast vs warm) · ideal clarify prompts not shown |

Screenshots: `01-session1-learn.png`, `02-session2-recall.png`, `03-settings-forget-me.png`, `04-forget-after.png`, `05-cold-start.png`.

---

## What we ran (recruiter)

| Step | Action | Observation | Result |
|------|--------|-------------|--------|
| Login | Recruiter → `/recruiter/agent` | Page “AI Recruiter Agent”; Supervisor chrome visible | **PASS** (load) |
| Chat | Try chips / question box | **Disabled** — UI gates on `jobs.data?.length` | **BLOCKED** |
| Jobs | `/recruiter/jobs` | **“0 listings / No job posts yet”** | Explains disabled agent |
| Forget UI | `/settings` as recruiter | **Forget my agent memory** present | **PASS** |

Screenshots: `07-recruiter-agent.png`, `08-recruiter-jobs.png`.

---

## Brief requirements vs status

| # | A4 requirement | Status | Notes |
|---|----------------|--------|-------|
| 1 | Durable multi-layer memory (Path B + episodic + semantic); Supervisor writes | **Met in product** · **live seeker evidence partial** | Live forget counts prove rows existed; S1→S2 personalization observed |
| 2 | Semantic recall into context; side-by-side vs cold | **Partial live** · **offline harness strong** | Warm: 2 React-matched jobs · Cold: 8 broader; README + `a4:memory-eval` still the measured bar |
| 3 | Compaction + token/fidelity | **Met offline / README** | Not visually proven in UI chrome (expected) |
| 4 | Governance: PII, RLS, write policy, forget-me | **Met** · forget **live PASS** | Toast UX flaky; API OK |
| 5 | Before/after numbers in README | **Met** | 412→251, 50%, fidelity 4/4 |
| — | Decision Log | **Met** | In repo |
| — | Write-up | **Drafted** | `ASSESSMENT_4_SUBMISSION.md` |
| — | 3–5 min demo | **Incomplete** | Script ready; video not recorded |
| — | `assessment-4` tag | **Incomplete** | Not created yet |
| — | Recruiter rubric memory on live agent | **Not fulfilled for this account** | Need owned/approved jobs then re-test |

---

## Gaps / not fully fulfilled (updated after fixes)

| Gap | Fix status (code) | Still needs live |
|-----|-------------------|------------------|
| S1 weak “synthetic career context” | **Fixed in Discovery** — skill-only broaden when location empties pool; no corpus-only fake success for job search | Deploy + re-smoke S1 |
| Cold-start dumps generic jobs | **Fixed** — vague “Find jobs for me” with no skills/memory → `needs_clarification` | Deploy + re-smoke after forget |
| Forget-me toast flaky | **Fixed** — toast after dialog close + 6s duration; confirm uses `Button` not `AlertDialogAction` | Deploy + re-check Settings |
| Recruiter agent 0 jobs | **UX fixed** — empty-state banner with Post a job / Company links | Recruiter must **post ≥1 job** (admin-approve if required) then re-demo memory |
| DCT pack | Unchanged | Demo video + `assessment-4` tag + DCT submit |

### Code touchpoints (2026-11-27)

- [`src/lib/ai/agents/discovery.ts`](../src/lib/ai/agents/discovery.ts) — broaden + early clarify  
- [`src/lib/ai/agents/supervisor.ts`](../src/lib/ai/agents/supervisor.ts) — `answerNote` for broadened replies  
- [`src/components/settings/ForgetAgentMemorySection.tsx`](../src/components/settings/ForgetAgentMemorySection.tsx) — toast reliability  
- [`src/routes/_app.recruiter.agent.tsx`](../src/routes/_app.recruiter.agent.tsx) — empty jobs banner  

Tests: `guardrail-confidence` + `a4-memory-layer` + `assistant-coverage` **63 passed**.

---

## Recommended next actions

1. **Commit + deploy** these fixes to `main` (ask for commit if needed).  
2. Re-run seeker smoke: S1 React/Dhaka → live cards or clear broaden note; forget toast; cold “Find jobs for me” → clarify.  
3. As recruiter: **Post a job** (and get approval if pending) → unlock `/recruiter/agent` → Session1 rubric/pref → Session2 recall.  
4. Record 3–5 min demo · tag `assessment-4` · DCT submit.

---

## Reproduce offline (always)

```sh
npm test -- src/test/a4-memory-layer.test.ts
npm run a4:memory-eval
npm run a4:recall-trace
```
