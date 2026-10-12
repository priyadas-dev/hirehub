import { describe, expect, it } from "vitest";
import {
  buildCreateCompanyPayload,
  buildSaveCompanyPayload,
} from "@/lib/company-profile";

describe("company profile payloads (admin approval required)", () => {
  const fields = {
    name: "Acme Corp",
    industry: "Technology",
    website: "https://acme.example",
  };
  const recruiterId = "22222222-2222-4222-8222-222222222222";

  it("creates companies as pending only", () => {
    const payload = buildCreateCompanyPayload(recruiterId, fields);
    expect(payload.status).toBe("pending");
    expect(payload.recruiter_id).toBe(recruiterId);
    expect(payload.name).toBe("Acme Corp");
    expect(payload).not.toMatchObject({ status: "approved" });
  });

  it("save payload never includes status (cannot self-approve)", () => {
    const payload = buildSaveCompanyPayload(fields);
    expect(payload).toEqual({
      name: "Acme Corp",
      industry: "Technology",
      website: "https://acme.example",
    });
    expect(payload).not.toHaveProperty("status");
    expect(payload).not.toHaveProperty("recruiter_id");
  });

  it("does not promote pending leftovers via payload helpers", () => {
    const create = buildCreateCompanyPayload(recruiterId, fields);
    const save = buildSaveCompanyPayload({ ...fields, name: "Acme Updated" });
    expect(create.status).toBe("pending");
    expect("status" in save).toBe(false);
  });
});
