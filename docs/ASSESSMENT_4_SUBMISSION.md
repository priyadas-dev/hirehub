# HireHub: Assessment 4 submission write-up

**SJ Innovation** · Priya Das · Mentor: Amol — Tech Manager  
**Assessment:** Level 4 Capstone — **Memory Layer** (not Orchestration)  
**Report date:** 2026-11-27  

Printable A3-style report: [`ASSESSMENT_4_SUBMISSION_REPORT.html`](./ASSESSMENT_4_SUBMISSION_REPORT.html) (same cover / table / accent language as Assessment 3).

HireHub’s Assessment 4 is a finished depth build on one advanced layer: durable multi-layer agent memory on the live product. The assistant learns seeker preferences across sessions, recalls them with semantic search, compacts long history without dropping key facts, and supports an explicit **forget me** path. Memory is written only through the Supervisor (never the browser). Free tools only (gte-small / pgvector).

| Link | URL |
|------|-----|
| Live app | https://hirehub-dev.vercel.app/ |
| Public repo | https://github.com/sjinnovation/hirehub |
| Release tag | [`assessment-4`](https://github.com/sjinnovation/hirehub/tree/assessment-4) |
| Demo video (3–5 min) | [Google Drive — internship demos](https://drive.google.com/drive/folders/1-YBMpo5wnSHDzEU4dHKXrC3ithZVy3Sn?usp=sharing) — A4 Memory: Session1 → Session2 → forget-me → cold start |
| Decision Log | [`ASSESSMENT_4_DECISION_LOG.md`](./ASSESSMENT_4_DECISION_LOG.md) |
| Live evidence | [`ASSESSMENT_4_LIVE_UI_FULFILLMENT.md`](./ASSESSMENT_4_LIVE_UI_FULFILLMENT.md) · [`docs/evidence/a4-memory-smoke/`](./evidence/a4-memory-smoke/) |
| Before/after metrics | [`README.md`](../README.md#assessment-4--memory-layer-before--after) |
| Supabase project | `munqgybiuqpncxbgfvdp` |

### Submission checklist

| # | DCT / brief item | Status | Where |
|---|------------------|--------|--------|
| 1 | Live URL + public repo | **Delivered** | Table above |
| 2 | Chosen depth layer end-to-end on live app | **Delivered** | §2 · seeker Memory path |
| 3 | Technical depth (recall, compaction, governance) | **Delivered** | §1 · §4 · phase notes |
| 4 | Before/after numbers in README | **Delivered** | README A4 table · §3 |
| 5 | Memory governance & safety | **Delivered** | §4 |
| 6 | Decision Log | **Delivered** | Linked above |
| 7 | Write-up + 3–5 min demo | **Delivered** | This doc · Drive video |
| 8 | `assessment-4` tag | **Delivered** | Table above |

---

## 1. What shipped (Memory Layer)

- **Working / Path B:** durable `agent_sessions` hydrate/persist (JWT + RLS)
- **Episodic:** `agent_memory_events` per-user event log
- **Semantic:** `agent_semantic_memories` + `match_agent_semantic_memories` (gte-small 384-d), top-k=5 inject into Supervisor
- **Compaction:** rolling redacted summary when session blob exceeds budget
- **Governance:** PII redaction on write, write-policy allow-list, own-row RLS, Settings **Forget my agent memory**, account-delete also clears memory tables
- **Discovery polish:** location broaden when no local matches; vague “find jobs” clarifies when memory is empty; reliable forget-me toast
- **Proof harness:** `npm run a4:memory-eval`, `npm run a4:recall-trace`, `src/test/a4-memory-layer.test.ts`

Decision Log (why Memory, trade-off, cut & reflect): [`ASSESSMENT_4_DECISION_LOG.md`](./ASSESSMENT_4_DECISION_LOG.md).

Capstone scope is **one layer deep (Memory)** on the live HireHub seeker assistant. Recruiter Agent shortlist/outreach remains job-gated by design (owned listings required); both roles share Settings **Forget my agent memory**.

---

## 2. Live proof — Session1 → Session2 → forget-me

**App:** https://hirehub-dev.vercel.app/ · **Primary demo role:** Job Seeker  

| Step | Action | Result |
|------|--------|--------|
| Auth gate | `/settings` while logged out | Redirects to `/auth` |
| Session 1 | `/seeker/assistant` — “I want React frontend jobs in Dhaka” | Preferences learned; durable memory written |
| Session 2 | New chat — “Find jobs for me” | Recalled skills; **2** React-matched jobs without re-asking |
| Forget me | Settings → **Forget my agent memory** | API cleared **6** sessions / **28** events / **8** semantic facts |
| Cold start | New chat — “Find jobs for me” | Memory cleared; colder / less personalized results |
| Recruiter Settings | Forget-me control as recruiter | Present and available |

Screenshots and notes: [`docs/evidence/a4-memory-smoke/`](./evidence/a4-memory-smoke/) · narrative: [`ASSESSMENT_4_LIVE_UI_FULFILLMENT.md`](./ASSESSMENT_4_LIVE_UI_FULFILLMENT.md).

---

## 3. Measured before/after (README)

Reproducible offline harness (also surfaced in README):

| Metric | Before (cold / raw) | After (warm / compact) |
|--------|--------------------:|-----------------------:|
| Clarifying signals | 2 | 1 |
| Personalization lift | — | **50%** fewer clarify signals |
| Context tokens (session blob) | 412 | 251 (**39.1%↓**) |
| Fact fidelity after compact | — | **pass** (4/4) |
| Ideal-term overlap | 0.00 | 0.24 |

```sh
npm run a4:memory-eval
npm run a4:recall-trace
npm test -- src/test/a4-memory-layer.test.ts
```

---

## 4. Governance & safety

| Control | Evidence |
|---------|----------|
| Supervisor-only writes | `supervisor-memory-layer` + seeker/recruiter entrypoints |
| PII on write | Redaction in semantic/episodic upsert + session payload |
| Own-row RLS | Live policies on three memory tables |
| Forget me | Settings UI → `forgetMyAgentMemory` (live delete counts above) |
| Account delete | Clears `agent_sessions` / `agent_memory_events` / `agent_semantic_memories` |

Notes: [`ASSESSMENT_4_PHASE4_GOVERNANCE.md`](./ASSESSMENT_4_PHASE4_GOVERNANCE.md), [`ASSESSMENT_4_PHASE3_COMPACTION.md`](./ASSESSMENT_4_PHASE3_COMPACTION.md).

---

## 5. Demo and credentials

| Item | Detail |
|------|--------|
| Live app | https://hirehub-dev.vercel.app/ |
| Demo video | [Drive folder](https://drive.google.com/drive/folders/1-YBMpo5wnSHDzEU4dHKXrC3ithZVy3Sn?usp=sharing) — A4 Memory Layer walkthrough (3–5 min) |
| Tag | [`assessment-4`](https://github.com/sjinnovation/hirehub/tree/assessment-4) |
| Admin / Recruiter / Job Seeker | Shared via Dev Control Tower / DM only |

Emails and passwords are **not** published in this report.

---

## 6. How to reproduce

```sh
npm test -- src/test/a4-memory-layer.test.ts
npm run a4:memory-eval
npm run a4:recall-trace
```

Live: open https://hirehub-dev.vercel.app/ as Job Seeker — Session1 learn → Session2 recall → Forget me → cold start.

**Delivery summary:** Finished Memory Layer on public HireHub — Path B + episodic + semantic recall, compaction with fidelity, forget-me governance, README before/after numbers, Decision Log, live seeker Session1→Session2 proof, `assessment-4` tag, and DCT demo pack.
