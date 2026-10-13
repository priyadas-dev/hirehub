import { useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, Settings } from "lucide-react";
import { toast } from "sonner";
import { CardSkeleton, ErrorState, PageHeader } from "@/components/feedback/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { ownProfileSchema, resumeUrlSchema, updateOwnProfile } from "@/lib/profile";
import { supabase } from "@/integrations/supabase/client";

const schema = ownProfileSchema.extend({
  resume_url: resumeUrlSchema,
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
      const [{ data: p, error: pErr }, { data: authData, error: authErr }, latestApp] = await Promise.all([
        supabase.from("profiles").select("full_name,email,phone").eq("id", id!).maybeSingle(),
        supabase.auth.getUser(),
        supabase
          .from("applications")
          .select("resume_url,jobs(title)")
          .eq("seeker_id", id!)
          .not("resume_url", "is", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (pErr) throw pErr;
      if (authErr) throw authErr;
      if (latestApp.error) throw latestApp.error;

      const meta = (authData.user?.user_metadata ?? {}) as Record<string, unknown>;
      const metaResume = typeof meta["resume_url"] === "string" ? meta["resume_url"] : "";
      const appResume = latestApp.data?.resume_url ?? "";

      return {
        full_name: p?.full_name ?? "",
        email: p?.email ?? "",
        phone: p?.phone ?? "",
        resume_url: metaResume || appResume || "",
        resumeSource: metaResume
          ? ("profile" as const)
          : appResume
            ? ("application" as const)
            : ("none" as const),
        latestJobTitle: latestApp.data?.jobs?.title ?? null,
      };
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: "", phone: "", resume_url: "" },
  });

  useEffect(() => {
    if (profile.data) {
      form.reset({
        full_name: profile.data.full_name,
        phone: profile.data.phone,
        resume_url: profile.data.resume_url,
      });
    }
  }, [profile.data, form]);

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!id) throw new Error("Not signed in");

      await updateOwnProfile(id, {
        full_name: values.full_name,
        phone: values.phone,
      });

      const resume = values.resume_url?.trim() || "";
      const { error: metaErr } = await supabase.auth.updateUser({
        data: { resume_url: resume || null },
      });
      if (metaErr) throw metaErr;
    },
    onSuccess: async () => {
      toast.success("Profile updated", {
        description: "Name, phone, and preferred resume URL are saved.",
      });
      await qc.invalidateQueries({ queryKey: ["seeker-profile", id] });
      await qc.invalidateQueries({ queryKey: ["seeker-latest-resume", id] });
      await qc.invalidateQueries({ queryKey: ["own-profile", id] });
      await refresh();
    },
    onError: (e: Error) => toast.error("Could not update profile", { description: e.message }),
  });

  if (profile.isLoading) return <CardSkeleton rows={5} />;
  if (profile.isError) return <ErrorState onRetry={() => void profile.refetch()} />;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Job Seeker"
        title="My profile / resume"
        description="Update your contact details and preferred resume link used when you apply."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/settings">
                <Settings /> Settings
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/seeker/jobs">
                <Briefcase /> Browse jobs
              </Link>
            </Button>
          </div>
        }
      />

      <form
        className="surface-card max-w-xl space-y-5 p-5 sm:p-6"
        onSubmit={form.handleSubmit((v) => save.mutate(v))}
        noValidate
      >
        <div className="space-y-2">
          <Label htmlFor="email">Account email</Label>
          <Input id="email" value={profile.data?.email || user?.email || ""} disabled readOnly autoComplete="username" />
          <p className="text-xs text-muted-foreground">
            This is your Supabase Auth sign-in email. It cannot be edited or saved from this profile form.
          </p>
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
          <Input id="phone" {...form.register("phone")} placeholder="+880…" inputMode="tel" />
          {form.formState.errors.phone && (
            <p className="text-xs text-destructive">{form.formState.errors.phone.message}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="resume_url">Resume URL</Label>
          <Input id="resume_url" placeholder="https://…" {...form.register("resume_url")} />
          {form.formState.errors.resume_url && (
            <p className="text-xs text-destructive">{form.formState.errors.resume_url.message}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {profile.data?.resumeSource === "application" && profile.data.latestJobTitle
              ? `Currently prefilled from your application to ${profile.data.latestJobTitle}. Saving stores it as your preferred resume for new applications.`
              : "This preferred resume is used to prefill the apply form on job details."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button type="submit" variant="signal" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save profile"}
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link to="/seeker">Back to dashboard</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
