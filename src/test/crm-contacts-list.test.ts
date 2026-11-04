import { describe, expect, it } from "vitest";
import {
  buildManualContactUpdate,
  collectContactFilterOptions,
  crmContactSource,
  listCrmContactsPage,
  paginateCrmContacts,
  sortCrmContacts,
} from "@/lib/crm/contacts-list";
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

describe("CRM contacts list", () => {
  it("derives contact source from seeker profile link", () => {
    expect(crmContactSource(contact({ id: "1", email: "a@b.com" }))).toBe("manual");
    expect(
      crmContactSource(contact({ id: "2", email: "c@d.com", seekerProfileId: "seeker-1" })),
    ).toBe("import");
  });

  it("sorts and paginates contacts", () => {
    const rows = [
      contact({ id: "1", email: "z@b.com", fullName: "Zed", createdAt: "2026-01-03T00:00:00.000Z" }),
      contact({ id: "2", email: "a@b.com", fullName: "Amy", createdAt: "2026-01-01T00:00:00.000Z" }),
    ];
    const sorted = sortCrmContacts(rows, "name", "asc");
    expect(sorted[0].fullName).toBe("Amy");
    const page = paginateCrmContacts(sorted, 1, 1);
    expect(page.contacts).toHaveLength(1);
    expect(page.totalPages).toBe(2);
  });

  it("filters by skill and status then pages", () => {
    const rows = [
      contact({
        id: "1",
        email: "dev@ex.com",
        skills: ["React"],
        applicationStatus: "applied",
      }),
      contact({ id: "2", email: "ops@ex.com", skills: ["Ops"] }),
    ];
    const page = listCrmContactsPage(rows, R1, {
      skills: ["React"],
      applicationStatuses: ["applied"],
      page: 1,
      pageSize: 10,
    });
    expect(page.total).toBe(1);
    expect(page.contacts[0].email).toBe("dev@ex.com");
  });

  it("collects filter options from owned contacts only", () => {
    const rows = [
      contact({ id: "1", email: "a@b.com", skills: ["React"], jobCategories: ["IT"] }),
      contact({ id: "2", email: "b@b.com", recruiterId: "other", skills: ["Hidden"] }),
    ];
    const opts = collectContactFilterOptions(rows, R1);
    expect(opts.skills).toEqual(["React"]);
    expect(opts.jobCategories).toEqual(["IT"]);
  });

  it("blocks synced field edits for imported contacts", () => {
    const imported = contact({
      id: "1",
      email: "a@b.com",
      seekerProfileId: "s1",
      skills: ["React"],
    });
    const blocked = buildManualContactUpdate(imported, { skills: ["Vue"] });
    expect(blocked.ok).toBe(false);
    const ok = buildManualContactUpdate(imported, { notes: "Follow up" });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.patch.notes).toBe("Follow up");
  });

  it("allows manual contact skill and segment kind edits", () => {
    const manual = contact({ id: "1", email: "a@b.com", skills: ["A"] });
    const ok = buildManualContactUpdate(manual, { skills: ["B"], segmentKind: "active" });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.patch.skills).toEqual(["B"]);
      expect(ok.patch.segmentKind).toBe("active");
    }
  });
});
