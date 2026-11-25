# Assessment 4 — Understanding (quick re-read)

> HireHub capstone. Depth on **one** layer. Chosen path: **Memory** (not Orchestration).

## One sentence

A3 shipped multi-agent HireHub with ephemeral Path A memory. A4 makes Path B real and turns HireHub into a recruiting copilot that **remembers**, with measured proof.

## A3 → A4

| A3 | A4 |
|----|----|
| Breadth (agents, integrations, RAG eval) | Depth (Memory layer only) |
| Path A = in-process Map | Path B durable + episodic + semantic |
| Path B = proposed SQL | Path B applied + recall + forget-me |

## Why Memory (not Orchestration)

- Brief title and REQUIRED section are Memory.
- Path B adapter + gte-small/pgvector already exist → lower 1-week risk.
- Orchestration (DAG/planner/crash-resume) is mostly greenfield.
- Memory is the foundation future orchestration would need anyway.
- Pick **one** layer — not both. Orchestration is an optional alternate only.

## Three memory layers

1. **Working** — in-process turn buffer (Path A / `server-memory`)
2. **Episodic** — durable per-user event log across sessions
3. **Semantic** — learned facts/preferences embedded in pgvector

## Evidence A4 demands

1. Schema + session1 → session2 recall trace
2. Side-by-side recalled memory vs cold start
3. Before/after token count + fact fidelity
4. RLS + redaction-on-write + forget-me clears recall
5. Before/after table in README

## Hard trade-off

Recall quality vs context budget: top-k=5 similarity×recency + rolling summary (not full transcript).
