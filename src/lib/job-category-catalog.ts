import { supabase } from "@/integrations/supabase/client";
import type { JobCategoryRow } from "@/lib/job-categories";

export const JOB_CATEGORY_CATALOG_QUERY_KEY = ["job-category-catalog"] as const;

export function isJobCategorySchemaUnavailable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return (
    error.code === "PGRST205" ||
    error.code === "42703" ||
    error.code === "42P01" ||
    msg.includes("job_categories") ||
    msg.includes("could not find the table") ||
    msg.includes("does not exist")
  );
}

export async function fetchJobCategoryCatalog(): Promise<{
  rows: JobCategoryRow[];
  unavailable: boolean;
}> {
  const { data, error } = await supabase
    .from("job_categories")
    .select("id,scope,owner_recruiter_id,name,name_normalized,active")
    .order("name", { ascending: true });

  if (error) {
    if (isJobCategorySchemaUnavailable(error)) {
      return { rows: [], unavailable: true };
    }
    throw error;
  }

  return { rows: (data ?? []) as JobCategoryRow[], unavailable: false };
}

export async function createRecruiterJobCategory(name: string): Promise<JobCategoryRow> {
  const trimmed = name.trim();
  if (trimmed.length < 1) throw new Error("Category name is required.");
  if (trimmed.length > 80) throw new Error("Category name is too long (max 80 characters).");

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error("Not signed in");

  const { data, error } = await supabase
    .from("job_categories")
    .insert({
      scope: "recruiter",
      owner_recruiter_id: user.id,
      name: trimmed,
    })
    .select("id,scope,owner_recruiter_id,name,name_normalized,active")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("You already have a category with this name.");
    }
    if (/conflicts with a default or global category/i.test(error.message ?? "")) {
      throw new Error("This name matches a default or global category. Choose a different name.");
    }
    throw error;
  }

  return data as JobCategoryRow;
}

export async function updateRecruiterJobCategory(input: {
  id: string;
  name?: string;
  active?: boolean;
}): Promise<JobCategoryRow> {
  const patch: { name?: string; active?: boolean } = {};
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (trimmed.length < 1) throw new Error("Category name is required.");
    if (trimmed.length > 80) throw new Error("Category name is too long (max 80 characters).");
    patch.name = trimmed;
  }
  if (input.active !== undefined) patch.active = input.active;

  const { data, error } = await supabase
    .from("job_categories")
    .update(patch)
    .eq("id", input.id)
    .select("id,scope,owner_recruiter_id,name,name_normalized,active")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("You already have a category with this name.");
    }
    throw error;
  }

  return data as JobCategoryRow;
}

export async function createGlobalJobCategory(name: string): Promise<JobCategoryRow> {
  const trimmed = name.trim();
  if (trimmed.length < 1) throw new Error("Category name is required.");
  if (trimmed.length > 80) throw new Error("Category name is too long (max 80 characters).");

  const { data, error } = await supabase
    .from("job_categories")
    .insert({
      scope: "global",
      name: trimmed,
    })
    .select("id,scope,owner_recruiter_id,name,name_normalized,active")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("A global category with this name already exists.");
    }
    throw error;
  }

  return data as JobCategoryRow;
}

export async function updateGlobalJobCategory(input: {
  id: string;
  name?: string;
  active?: boolean;
}): Promise<JobCategoryRow> {
  const patch: { name?: string; active?: boolean } = {};
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (trimmed.length < 1) throw new Error("Category name is required.");
    patch.name = trimmed;
  }
  if (input.active !== undefined) patch.active = input.active;

  const { data, error } = await supabase
    .from("job_categories")
    .update(patch)
    .eq("id", input.id)
    .select("id,scope,owner_recruiter_id,name,name_normalized,active")
    .single();

  if (error) throw error;
  return data as JobCategoryRow;
}
