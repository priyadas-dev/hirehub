# GitHub Release: assessment-3

**Tag:** `assessment-3`  
**Repo:** https://github.com/priyadas-dev/hirehub  
**Purpose:** Assessment 3 mentor sign-off evidence pack (Amol closeout).

## Create (run once, from a clean green commit on `main`)

```bash
# 1) Confirm CI is green for this commit on GitHub Actions, then:
git fetch origin
git checkout main
git pull origin main

# 2) Annotated tag (do not force-move if it already exists on remote)
git tag -a assessment-3 -m "Assessment 3 submission — integrated HireHub (CI, Sentry, agents, RAG 20k, resume RLS)"

# 3) Push tag (never force-push main / never rewrite Lovable history)
git push origin assessment-3

# 4) Create GitHub Release (GitHub UI or gh):
#    Title: assessment-3
#    Target: tag assessment-3
#    Body: paste the Summary below
```

Release URL shape after create:  
`https://github.com/priyadas-dev/hirehub/releases/tag/assessment-3`

## Summary (paste into GitHub Release body)

HireHub Assessment 3 — multi-role recruitment portal with:

- Real integrations (Resend outbound + Svix inbound; Google Calendar)
- Recruiter CRM (contacts / segments / campaigns)
- Supervised multi-agent stack + guardrails + confirm-to-apply
- RAG eval at 20k (Hit@5 0.55 → 0.70) and honest classifier Macro F1 0.861
- Production surface: GitHub Actions CI, Sentry, private resume Storage RLS, idempotent apply

Mentor closeout extras: live other-recruiter resume deny, Security Advisor pass, agent apply E2E with real write, migration status for Path B / 0022 / 0028.

## Published evidence (2026-11-24)

| Item | URL |
|------|-----|
| Green CI run | https://github.com/priyadas-dev/hirehub/actions/runs/44091862041 |
| GitHub Release | https://github.com/priyadas-dev/hirehub/releases/tag/assessment-3 |
| Tagged commit | `91fc566` on `main` |

Paste both URLs into Dev Control Tower as well.
