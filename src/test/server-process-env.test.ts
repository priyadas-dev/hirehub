import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureProcessEnvFromDotenv,
  normalizeProcessEnvValue,
  resetProcessEnvFromDotenvForTests,
} from "@/lib/server-process-env";
import { isSupabaseServiceRoleConfigured } from "@/lib/oauth-signup-role";

describe("server-process-env", () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let tempDir: string | undefined;

  afterEach(() => {
    resetProcessEnvFromDotenvForTests();
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("strips wrapping quotes from env values", () => {
    expect(normalizeProcessEnvValue('  "https://example.supabase.co"  ')).toBe(
      "https://example.supabase.co",
    );
    expect(normalizeProcessEnvValue("")).toBe("");
  });

  it("fills missing process.env keys from a .env file once", () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    tempDir = mkdtempSync(path.join(tmpdir(), "hirehub-env-"));
    writeFileSync(
      path.join(tempDir, ".env"),
      [
        'SUPABASE_URL="https://example.supabase.co"',
        "SUPABASE_SERVICE_ROLE_KEY=test-service-role-key",
      ].join("\n"),
      "utf8",
    );

    ensureProcessEnvFromDotenv(tempDir);
    expect(process.env.SUPABASE_URL).toBe("https://example.supabase.co");
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe("test-service-role-key");
    expect(isSupabaseServiceRoleConfigured()).toBe(true);
  });
});

describe("isSupabaseServiceRoleConfigured quotes", () => {
  it("accepts quoted values", () => {
    expect(
      isSupabaseServiceRoleConfigured({
        SUPABASE_URL: '"https://example.supabase.co"',
        SUPABASE_SERVICE_ROLE_KEY: "'test-key'",
      }),
    ).toBe(true);
  });
});
