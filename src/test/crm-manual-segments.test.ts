import { describe, expect, it } from "vitest";
import { defaultManualSegmentName, dedupeContactIds, isCrmSegmentId } from "@/lib/crm/manual-segments";
import { createSegmentRecord, resolveSegmentAudience } from "@/lib/crm/segments";
import { buildCrmSegmentInsertRow } from "@/lib/crm/supabase-crm";
import type { CrmContact } from "@/lib/crm/types";

const R1 = "11111111-1111-4111-8111-111111111111";

function contact(partial: Partial<CrmContact> & Pick<CrmContact, "id" | "email">): CrmContact {
  return {
    recruiterId: R1,
    companyId: null,
    seekerProfileId: null,
    emailNormalized: partial.email.toLowerCase(),
    fullName: null,
    skills: [],
    jobInterests: [],
    jobCategories: [],
    applicationStatus: null,
    segmentKind: "new",
    hubspotContactId: null,
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("CRM manual segments", () => {
  it("accepts UUID segment ids and rejects invalid route params", () => {
    expect(isCrmSegmentId("00000000-0000-4000-8000-000000000000")).toBe(true);
    expect(isCrmSegmentId("f5b3f02a-793d-4dd7-91c5-f94f00b76603")).toBe(true);
    expect(isCrmSegmentId("not-a-uuid")).toBe(false);
    expect(isCrmSegmentId("")).toBe(false);
    expect(isCrmSegmentId("  ")).toBe(false);
  });

  it("dedupes contact ids for membership", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(dedupeContactIds([id, id, "  "])).toEqual([id]);
  });

  it("builds default manual segment names", () => {
    expect(defaultManualSegmentName([])).toMatch(/Manual segment/);
    expect(defaultManualSegmentName([contact({ id: "1", email: "a@b.com", fullName: "Alex" })])).toMatch(/Alex/);
    expect(
      defaultManualSegmentName([
        contact({ id: "1", email: "a@b.com", jobCategories: ["IT"] }),
        contact({ id: "2", email: "b@b.com", jobCategories: ["IT"] }),
      ]),
    ).toMatch(/IT · 2 contacts/);
  });

  it("resolves manual audience from member contact ids only", () => {
    const c1 = contact({ id: "c1", email: "one@ex.com" });
    const c2 = contact({ id: "c2", email: "two@ex.com" });
    const seg = createSegmentRecord({
      recruiterId: R1,
      name: "Pick",
      segmentType: "manual",
    });
    expect("error" in seg).toBe(false);
    if ("error" in seg) return;
    const audience = resolveSegmentAudience([c1, c2], seg, { manualMemberContactIds: ["c2"] });
    expect(audience.map((c) => c.email)).toEqual(["two@ex.com"]);
  });

  it("builds manual segment insert row with owner recruiter_id and segment_type", () => {
    const row = buildCrmSegmentInsertRow({
      recruiterId: R1,
      name: "IT pool",
      kind: "new",
      filter: {},
      segmentType: "manual",
    });
    expect(row.recruiter_id).toBe(R1);
    expect(row.segment_type).toBe("manual");
    expect(row.filter_json).toEqual({});
  });

  it("returns empty manual audience without member ids", () => {
    const seg = createSegmentRecord({
      recruiterId: R1,
      name: "Empty manual",
      segmentType: "manual",
    });
    expect("error" in seg).toBe(false);
    if ("error" in seg) return;
    expect(resolveSegmentAudience([contact({ id: "1", email: "a@b.com" })], seg)).toHaveLength(0);
  });
});
