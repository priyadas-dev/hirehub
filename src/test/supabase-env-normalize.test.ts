import { describe, expect, it } from "vitest";
import { normalizeSupabaseEnvValue } from "@/integrations/supabase/client";

describe("normalizeSupabaseEnvValue", () => {
  it("strips wrapping straight and curly quotes and trims", () => {
    expect(normalizeSupabaseEnvValue('  "https://example.supabase.co"  ')).toBe(
      "https://example.supabase.co",
    );
    expect(normalizeSupabaseEnvValue("'https://example.supabase.co'")).toBe(
      "https://example.supabase.co",
    );
    expect(normalizeSupabaseEnvValue("\u201Chttps://example.supabase.co\u201D")).toBe(
      "https://example.supabase.co",
    );
    expect(normalizeSupabaseEnvValue("https://example.supabase.co")).toBe(
      "https://example.supabase.co",
    );
  });

  it("returns empty for blank input", () => {
    expect(normalizeSupabaseEnvValue(null)).toBe("");
    expect(normalizeSupabaseEnvValue(undefined)).toBe("");
    expect(normalizeSupabaseEnvValue("   ")).toBe("");
  });
});
