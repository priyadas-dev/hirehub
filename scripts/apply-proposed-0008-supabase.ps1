# Apply PROPOSED_0008 to Supabase project munqgybiuqpncxbgfvdp only.
# Does NOT use LOVABLE_DB_MIGRATION_URL.
#
# Usage (PowerShell):
#   $env:SUPABASE_DB_PASSWORD = '<database password from Dashboard → Project Settings → Database>'
#   # optional region override if pooler host differs:
#   # $env:SUPABASE_POOLER_HOST = 'aws-0-<region>.pooler.supabase.com'
#   .\scripts\apply-proposed-0008-supabase.ps1
#
# Or with a personal access token (Management API / CLI):
#   $env:SUPABASE_ACCESS_TOKEN = '<token from https://supabase.com/dashboard/account/tokens>'
#   .\scripts\apply-proposed-0008-supabase.ps1

$ErrorActionPreference = 'Stop'
$ProjectRef = 'munqgybiuqpncxbgfvdp'
$SqlPath = Join-Path $PSScriptRoot '..\drizzle\migrations\PROPOSED_0008_secure_resume_portfolio_company_logos.sql'
$SqlPath = (Resolve-Path $SqlPath).Path

if (-not (Test-Path $SqlPath)) {
  throw "SQL file not found: $SqlPath"
}

if ($env:SUPABASE_ACCESS_TOKEN) {
  Write-Host "Linking project $ProjectRef via access token…"
  npx supabase link --project-ref $ProjectRef
  Write-Host "Running SQL via supabase db query…"
  Get-Content -Raw $SqlPath | npx supabase db query --linked
  Write-Host "Done. Re-probe: profiles.resume_storage_path / companies.logo_url"
  exit 0
}

if (-not $env:SUPABASE_DB_PASSWORD) {
  Write-Host @"
Missing credentials for Supabase project $ProjectRef.

Set ONE of:
  `$env:SUPABASE_DB_PASSWORD   — Database password (Dashboard → Settings → Database)
  `$env:SUPABASE_ACCESS_TOKEN  — Personal access token (Dashboard → Account → Access Tokens)

Then re-run this script. Lovable DB URL is intentionally unused.
"@
  exit 1
}

# Project DB resolves to IPv6-only in ap-southeast-1; use IPv4 pooler for Windows clients.
$PoolerHost = if ($env:SUPABASE_POOLER_HOST) { $env:SUPABASE_POOLER_HOST } else { 'aws-0-ap-southeast-1.pooler.supabase.com' }
# Session mode (port 5432) is more reliable for DDL than transaction pooler 6543.
$User = "postgres.$ProjectRef"
$Pass = [uri]::EscapeDataString($env:SUPABASE_DB_PASSWORD)
$DbUrl = "postgresql://${User}:${Pass}@${PoolerHost}:5432/postgres"

Write-Host "Applying $SqlPath via pooler $PoolerHost (session mode)…"
Get-Content -Raw $SqlPath | npx supabase db query --db-url $DbUrl
Write-Host "Done. Re-probe columns with PostgREST before enabling uploads in UI."
