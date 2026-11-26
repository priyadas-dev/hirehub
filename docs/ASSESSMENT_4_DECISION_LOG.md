# Assessment 4 — Decision Log

**Intern:** Priya Das · **Product:** HireHub · **Date:** 2026-11-26

## Chosen: Memory (not Orchestration)

HireHub’s Assessment 3 stack already pointed at durable Path B (`agent_sessions`) beside ephemeral Path A, with PII redaction and gte-small/pgvector in-repo. The A4 brief titles **The Memory Layer** and scores recall, compaction, and forget-me — so finishing working + episodic + semantic memory is the path that fits this product and the one-week depth bar. Orchestration (DAG planner, crash-resume executor, parallel hiring pipeline) is mostly greenfield here and would risk a shallow demo. Memory is also the foundation any future orchestrator would need. Capstone rule: one layer deep — we chose Memory.

## Design: hard trade-off — recall quality vs context budget

We retrieve **top-k=5** semantic memories (similarity × recency × importance), inject a compact “Known about this user” block into Supervisor context, and **roll up** long transcripts into a redacted session `summary` instead of dumping full turn history. That keeps personalization high without blowing the session JSON / prompt budget. Full-history dumps and unlimited semantic hits were refused. README before/after (offline harness): context tokens **412 → 251**, fact fidelity **4/4**.

## Cut & reflect

- **Scoped out:** LangGraph/Temporal hiring DAG; paid embedding APIs; rebuilding Path A; a second depth layer.
- **Proud of:** Supervisor-only writes across Path B + episodic + semantic, forget-me that clears recall, and measured before/after numbers in the README.
- **Next:** Stronger fact extractors, memory write/recall observability traces, and optional recruiter-facing memory surfaces.
