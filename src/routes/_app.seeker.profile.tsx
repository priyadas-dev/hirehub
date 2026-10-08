import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CardSkeleton, ErrorState, PageHeader } from "@/components/feedback/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

const schema = z.object({
  full_name: z.string().trim().min(2, "Name is required"),
  phone: z.string().trim().optional(),
  resume_url: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^https?:\/\//i.test(v), "Resume must be a full URL starting with http"),
});

type FormValues = z.infer<typeof schema>;

export const Route = createFileRoute("/_app/seeker/profile")({
  head: () => ({
    meta: [
      { title: "My Profile — HireHub" },
      { name: "description", content: "Update your seeker profile and resume link." },
    ],
  }),
  component: SeekerProfilePage,
});

function SeekerProfilePage() {
  const { user, refresh } = useAuth();
  const id = user?.id;
  const qc = useQueryClient();

  const profile = useQuery({
    queryKey: ["seeker-profile", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name,email,phone")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  /** Resume lives on applications in the existing schema (no profiles.resume_url column). */
  const latestResume = useQuery({
    queryKey: ["seeker-latest-resume", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("id,resume_url,created_at,jobs(title)")
        .eq("seeker_id", id!)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: "", phone: "", resume_url: "" },
  });

  useEffect(() => {
    if (profile.data) {
      form.reset({
        full_name: profile.data.full_name ?? "",
        phone: profile.data.phone ?? "",
        resume_url: latestResume.data?.resume_url ?? "",
      });
    }
  }, [profile.data, latestResume.data, form]);

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!id) throw new Error("Not signed in");

      const { error: profileErr } = await supabase
        .from("profiles")
        .update({
          full_name: values.full_name.trim(),
          phone: values.phone?.trim() || null,
        })
        .eq("id", id);
      if (profileErr) throw profileErr;

      const resume = values.resume_url?.trim() || null;
      if (latestResume.data?.id) {
        const { error: appErr } = await supabase
          .from("applications")
          .update({ resume_url: resume })
          .eq("id", latestResume.data.id)
          .eq("seeker_id", id);
        if (appErr) throw appErr;
      } else if (resume) {
        throw new Error("Apply to a job first to attach a resume URL, or leave the resume field empty for now.");
      }
    },
    onSuccess: async () => {
      toast.success("Profile updated");
      await qc.invalidateQueries({ queryKey: ["seeker-profile", id] });
      await qc.invalidateQueries({ queryKey: ["seeker-latest-resume", id] });
      await qc.invalidateQueries({ queryKey: ["seeker-applications"] });
      await qc.invalidateQueries({ queryKey: ["seeker-application"] });
      await refresh();
    },
    onError: (e: Error) => toast.error("Could not update profile", { description: e.message }),
  });

  if (profile.isLoading || latestResume.isLoading) return <CardSkeleton rows={5} />;
  if (profile.isError) return <ErrorState onRetry={() => void profile.refetch()} />;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Job Seeker"
        title="My profile / resume"
        description="Keep your contact details current. Resume links are stored with your applications."
      />

      <form className="surface-card max-w-xl space-y-5 p-6" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" value={profile.data?.email ?? ""} disabled readOnly />
          <p className="text-xs text-muted-foreground">Email comes from your account and cannot be changed here.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="full_name">Full name</Label>
          <Input id="full_name" {...form.register("full_name")} placeholder="Your name" />
          {form.formState.errors.full_name && (
            <p className="text-xs text-destructive">{form.formState.errors.full_name.message}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" {...form.register("phone")} placeholder="+880…" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="resume_url">Resume URL</Label>
          <Input id="resume_url" placeholder="https://…" {...form.register("resume_url")} />
          {form.formState.errors.resume_url && (
            <p className="text-xs text-destructive">{form.formState.errors.resume_url.message}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {latestResume.data
              ? `Saved with your latest application${latestResume.data.jobs?.title ? ` (${latestResume.data.jobs.title})` : ""}.`
              : "No applications yet — submit an application first, then you can update the resume link here."}
          </p>
        </div>
        <Button type="submit" variant="signal" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save profile"}
        </Button>
      </form>
    </div>
  );
}
