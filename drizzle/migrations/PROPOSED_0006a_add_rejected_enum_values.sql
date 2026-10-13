-- PROPOSED — DO NOT APPLY until explicitly approved.
-- Purpose: add 'rejected' to company_status and job_status enums ONLY.
--
-- CRITICAL (PostgreSQL): Newly added enum labels cannot be used in the same
-- transaction as ALTER TYPE ... ADD VALUE (through at least PG 15). Commit this
-- migration (or run it in its own session) BEFORE PROPOSED_0006b.
--
-- Depends on: 0000–0003.
-- Apply order: 0004 → 0005 → 0006a (commit) → 0006b.
-- Forward-only: enum values cannot be removed safely — validate on staging first.
--
-- Requires PostgreSQL 15+ for IF NOT EXISTS (Supabase default).

ALTER TYPE public.company_status ADD VALUE IF NOT EXISTS 'rejected';
ALTER TYPE public.job_status ADD VALUE IF NOT EXISTS 'rejected';

-- Rollback: not practical (enum values are forward-only). Leave unused if rolled back.
