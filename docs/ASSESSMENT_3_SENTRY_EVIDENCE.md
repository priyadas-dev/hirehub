# Assessment 3 — Sentry observability evidence

**Status:** Complete (2026-11-24)  
**Guardian:** DSN values live only in host secrets / local `.env` — never committed.

## Configuration

| Item | Status |
|------|--------|
| Local `.env` `SENTRY_DSN` + `VITE_SENTRY_DSN` | Set |
| Vercel Production env (same keys) | Set + **redeployed** |
| Packages / hooks | `@sentry/node` + `@sentry/react` via `src/lib/observability/sentry.ts`, `src/server.ts`, `src/routes/__root.tsx` |

## Live error event

| Field | Value |
|-------|-------|
| Smoke command | `npm run a3:sentry-smoke` → `"ok": true` |
| Marker | `hirehub-a3-sentry-smoke-2026-11-24T06:25:04.122Z` |
| Sentry project | hirehub (HIREHUB-1), org `sj-innovation-q4` |
| Screenshot | [`a3-sentry-event-screenshot.png`](./a3-sentry-event-screenshot.png) |

## Reproduce

```bash
npm run a3:sentry-smoke
```

Open Sentry → Issues → event whose message contains `hirehub-a3-sentry-smoke-`.
