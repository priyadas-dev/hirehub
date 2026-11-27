# Assessment 4 — Memory governance & safety

## Requirement
PII redaction on write; RLS so each user’s memory is private; explicit write policy; working “forget me” delete path.

## What ships

| Control | Where |
|---------|--------|
| Write policy allow-list | `memory-write-policy.ts` — kinds/events + neverPersist |
| PII on write | `redactPii` in semantic/episodic upsert + session payload |
| Kind gate | `isAllowedSemanticKind` rejects out-of-policy upserts |
| Own-row RLS | Live DB policies on `agent_sessions`, `agent_memory_events`, `agent_semantic_memories` |
| Forget me | Settings → `ForgetAgentMemorySection` → `forgetMyAgentMemory` |
| Clears | Path B sessions + episodic + semantic + Path A process cache |
| Account delete | `performAccountDeletion` also deletes the three memory tables |

## Evidence
```sh
npm test -- src/test/a4-memory-layer.test.ts
```
Covers: policy reject, user isolation, redaction-on-write, forget clears semantic + episodic + Path A cache.

## Manual check
1. Settings → Forget agent memory → confirm toast counts  
2. Next assistant turn should cold-start (no remembered Dhaka/React)  
3. RLS: user A JWT must not read user B memory rows (DB policies)
