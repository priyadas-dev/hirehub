import { describe, expect, it } from "vitest";
import {
  DEFAULT_JOB_CATEGORY_ID,
  groupCategoriesForPicker,
  mergeJobCategories,
} from "@/lib/job-categories";

describe("job category catalog helpers", () => {
  it("groups defaults, private, and global rows for pickers", () => {
    const rows = groupCategoriesForPicker([
      {
        id: DEFAULT_JOB_CATEGORY_ID,
        scope: "default",
        owner_recruiter_id: null,
        name: "Other",
        name_normalized: "other",
        active: true,
      },
      {
        id: "11111111-1111-4111-8111-111111111111",
        scope: "recruiter",
        owner_recruiter_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Legal Tech",
        name_normalized: "legal tech",
        active: true,
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        scope: "global",
        owner_recruiter_id: null,
        name: "Healthcare",
        name_normalized: "healthcare",
        active: true,
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        scope: "recruiter",
        owner_recruiter_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Old pool",
        name_normalized: "old pool",
        active: false,
      },
    ]);
    expect(rows.defaults).toHaveLength(1);
    expect(rows.mine).toHaveLength(1);
    expect(rows.global).toHaveLength(1);
    expect(rows.inactiveAssigned).toHaveLength(1);
    expect(mergeJobCategories(["Healthcare"], "healthcare")).toEqual(["Healthcare"]);
  });
});
