# Assessment 4 — Compaction (summarization)

## Requirement
Rolling summaries so long history never blows the context window; measure token reduction + prove key facts survive.

## Implementation
- `src/lib/ai/memory/compaction.ts` — extractive rolling `summary`, trim turns
- Supervisor runs compaction each seeker turn when over budget
- Path B persist also compacts before `agent_sessions` write
- Trace: `supervisor.compaction` `{ compacted, beforeTokens, afterTokens, beforeTurns, afterTurns }`

## Evidence
```sh
npm run a4:memory-eval
npm test -- src/test/a4-memory-layer.test.ts
```

Typical offline numbers: tokens **412 → 251 (~39%↓)**, fidelity **pass 4/4**.
Artifact: `scripts/rag/out/a4-memory-eval.json`
