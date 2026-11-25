# Assessment 4 — 3–5 min demo script

## Prep

1. Apply DB migrations ([`ASSESSMENT_4_DB_APPLY.md`](./ASSESSMENT_4_DB_APPLY.md)).
2. `npm run dev`, sign in as seeker.
3. Optional: `npm run a4:memory-eval` to show README numbers.

## Demo flow

| Time | Action | Show |
|------|--------|------|
| 0:00 | Open `/seeker/assistant` | Fresh chat |
| 0:30 | “I want React and TypeScript frontend jobs in Dhaka” | Supervisor learns facts |
| 1:00 | Restart server (or new conversation id next day simulation) | Path B / semantic durability |
| 1:30 | “Find jobs for me” without repeating prefs | Recall changes answer vs cold start |
| 2:30 | Open Settings → Forget agent memory | Delete path |
| 3:00 | Ask again “Find jobs for me” | Cold start / re-asks prefs |
| 3:30 | Show README before/after table + Decision Log | Evidence |
| 4:30 | Optional: `npm test -- src/test/a4-memory-layer.test.ts` | Automated proof |

## DCT submit checklist

- [ ] Live URL
- [ ] Public repo
- [ ] Role credentials (DM / DCT only — not in git)
- [ ] Write-up + Decision Log
- [ ] Tag `assessment-4`
- [ ] 3–5 min demo recording or live walkthrough
