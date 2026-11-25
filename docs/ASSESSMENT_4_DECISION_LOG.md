# Assessment 4 — Decision Log

**Intern:** Priya Das · **Product:** HireHub · **Date:** 2026-11-23

## Chosen: Memory (not Orchestration)

HireHub’s A3 diagram already pointed at Path B (`agent_sessions` proposed, Path A ephemeral). The A4 brief titles **The Memory Layer** and scores recall, compaction, and forget-me. Path B adapters, PII redaction, and gte-small/pgvector already ship in-repo, so one week of depth is realistic. Orchestration (DAG planner, crash-resume executor, parallel hiring pipeline) is mostly greenfield here and would risk a shallow demo. Memory is also the foundation any future orchestrator would need.

## Design trade-off: recall quality vs context budget

We retrieve **top-k=5** semantic memories with a similarity × recency × importance blend, inject a compact “Known about this user” block into Supervisor context, and **roll up** long transcripts into a redacted `summary` instead of dumping full history. That keeps personalization high without blowing the session JSON / prompt budget.

## Cut & reflect

- **Scoped out:** LangGraph/Temporal hiring DAG; paid embedding APIs; rebuilding Path A.
- **Proud of:** Supervisor-only write path across working + episodic + semantic layers, with forget-me that actually clears recall, plus measured before/after numbers.
- **Next:** Stronger fact extractors, recruiter rubric UI surfaces, and optional observability traces for every memory write/recall.
