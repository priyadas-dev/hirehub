import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type CompanyFields = {
  name: string;
  industry: string | null;
  website: string | null;
};

/**
 * Insert must use status "pending" — that is what the existing company insert
 * policy allows. The owner may then set "approved", which is the active state
 * already stored on companies. No admin step, and no schema change.
 */
export async function createActiveCompany(recruiterId: string, fields: CompanyFields) {
  const { data: created, error: insertError } = await supabase
    .from("companies")
    .insert({ ...fields, recruiter_id: recruiterId, status: "pending" })
    .select("id")
    .single();
  if (insertError) throw insertError;

  const { data: active, error: activateError } = await supabase
    .from("companies")
    .update({ status: "approved" })
    .eq("id", created.id)
    .eq("recruiter_id", recruiterId)
    .select("id,status");
  if (activateError) throw activateError;
  if (!active?.some((row) => row.status === "approved")) {
    throw new Error("Company was saved but could not be activated.");
  }
  return created.id;
}

export async function saveActiveCompany(
  companyId: string,
  recruiterId: string,
  fields: CompanyFields,
) {
  const { data, error } = await supabase
    .from("companies")
    .update({ ...fields, status: "approved" })
    .eq("id", companyId)
    .eq("recruiter_id", recruiterId)
    .select("id,status");
  if (error) throw error;
  if (!data?.some((row) => row.status === "approved")) {
    throw new Error("Company could not be saved.");
  }
}

/** Clears a leftover pending company so it does not wait on admin review. */
async function activateOwnedCompany(companyId: string, recruiterId: string) {
  const { error } = await supabase
    .from("companies")
    .update({ status: "approved" })
    .eq("id", companyId)
    .eq("recruiter_id", recruiterId)
    .eq("status", "pending");
  if (error) throw error;
}

export function useEnsureCompanyActive(
  companyId: string | undefined,
  status: string | undefined,
  recruiterId: string | undefined,
) {
  const qc = useQueryClient();
  const tried = useRef<string | null>(null);

  useEffect(() => {
    if (!companyId || !recruiterId || status !== "pending") return;
    if (tried.current === companyId) return;
    tried.current = companyId;

    void activateOwnedCompany(companyId, recruiterId)
      .then(async () => {
        await qc.invalidateQueries({ queryKey: ["recruiter-company"] });
        await qc.invalidateQueries({ queryKey: ["recruiter-companies"] });
        await qc.invalidateQueries({ queryKey: ["admin-companies"] });
        await qc.invalidateQueries({ queryKey: ["admin-attention"] });
        await qc.invalidateQueries({ queryKey: ["dash-counts"] });
      })
      .catch((e: Error) => {
        toast.error("Could not activate company", { description: e.message });
      });
  }, [companyId, status, recruiterId, qc]);
}
