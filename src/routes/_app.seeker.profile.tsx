import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, Settings } from "lucide-react";
import { toast } from "sonner";
import { ResumePdfPicker, type ResumePickerValue } from "@/components/applications/ResumePdfPicker";
import { CardSkeleton, ErrorState, PageHeader } from "@/components/feedback/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFileUploadsReady } from "@/hooks/use-file-uploads-ready";
import { useAuth } from "@/lib/auth";
import { isMissingSchemaError } from "@/lib/hirehub-storage";
import { sendPasswordRecoveryEmail } from "@/lib/account-password";
import { ownProfileSchema, resumeUrlSchema, updateOwnProfile } from "@/lib/profile";
import { sendAccountMail } from "@/lib/send-account-mail";
import { removeResumeObject, saveProfileResume } from "@/lib/resume-upload";
import { supabase } from "@/integrations/supabase/client";

const schema = ownProfileSchema.extend({
  resume_url: resumeUrlSchema,
});

type FormValues = z.infer<typeof schema>;

export const Route = createFileRoute("/_app/seeker/profile")({
  head: () => ({
    meta: [
      { title: "My Profile — HireHub" },
      { name: "description", content: "Update your seeker profile and resume." },
    ],
  }),
  component: SeekerProfilePage,
});

function SeekerProfilePage() {
  const { user, refresh } = useAuth();
  const id = user?.id;
  const qc = useQueryClient();
  const uploadsReady = useFileUploadsReady();
  const canPersist = !!uploadsReady.data;
  const [resumeValue, setResumeValue] = useState<ResumePickerValue | null>(null);
  const [mailing, setMailing] = useState(false);
  const mailAccount = useServerFn(sendAccountMail);

  const profile = useQuery({
    queryKey: ["seeker-profile", id],
    enabled: !!id,
    queryFn: async () => {
      const withStorage = await supabase
        .from("profiles")
        .select("full_name,email,phone,resume_storage_path,resume_file_name")
        .eq("id", id!)
        .maybeSingle();

      let p = withStorage.data;
      if (withStorage.error && isMissingSchemaError(withStorage.error.message)) {
        const fallback = await supabase
          .from("profiles")
          .select("full_name,email,phone")
          .eq("id", id!)
          .maybeSingle();
        if (fallback.error) throw fallback.error;
        p = {
          ...fallback.data!,
          resume_storage_path: null,
          resume_file_name: null,
        };
      } else if (withStorage.error) {
        throw withStorage.error;
      }

      const [{ data: authData, error: authErr }, latestApp] = await Promise.all([
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
      if (authErr) throw authErr;
      if (latestApp.error) throw latestApp.error;

      const meta = (authData.user?.user_metadata ?? {}) as Record<string, unknown>;
      const metaResume = typeof meta["resume_url"] === "string" ? meta["resume_url"] : "";
      const appResume = latestApp.data?.resume_url ?? "";

      return {
        full_name: p?.full_name ?? "",
        email: p?.email ?? "",
        phone: p?.phone ?? "",
        resume_storage_path: p?.resume_storage_path ?? null,
        resume_file_name: p?.resume_file_name ?? null,
        resume_url: metaResume || appResume || "",
        resumeSource: p?.resume_storage_path
          ? ("profile_file" as const)
          : metaResume
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
        phone: profile.data.phone ?? "",
        resume_url: profile.data.resume_url,
      });
      setResumeValue(
        profile.data.resume_storage_path
          ? {
              storagePath: profile.data.resume_storage_path,
              fileName: profile.data.resume_file_name,
            }
          : null,
      );
    }
  }, [profile.data, form]);

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!id) throw new Error("Not signed in");

      await updateOwnProfile(id, {
        full_name: values.full_name,
        phone: values.phone,
      });

      if (canPersist) {
        const previousPath = profile.data?.resume_storage_path ?? null;
        await saveProfileResume(
          id,
          resumeValue?.storagePath
            ? { storagePath: resumeValue.storagePath, fileName: resumeValue.fileName || "resume.pdf" }
            : null,
        );
        if (previousPath && previousPath !== resumeValue?.storagePath) {
          try {
            await removeResumeObject(previousPath);
          } catch {
            /* best-effort */
          }
        }
      }

      // Keep legacy metadata URL for older apply flows when Storage is not ready.
      if (!canPersist) {
        const resume = values.resume_url?.trim() || "";
        const { error: metaErr } = await supabase.auth.updateUser({
          data: { resume_url: resume || null },
        });
        if (metaErr) throw metaErr;
      }
    },
    onSuccess: async () => {
      toast.success("Profile updated", {
        description: canPersist
          ? "Name, phone, and resume file are saved."
          : "Name, phone, and preferred resume URL are saved.",
      });
      await qc.invalidateQueries({ queryKey: ["seeker-profile", id] });
      await qc.invalidateQueries({ queryKey: ["seeker-latest-resume", id] });
      await qc.invalidateQueries({ queryKey: ["own-profile", id] });
      await refresh();
    },
    onError: (e: Error) => toast.error("Could not update profile", { description: e.message }),
  });

  if (profile.isLoading || uploadsReady.isLoading) return <CardSkeleton rows={5} />;
  if (profile.isError) return <ErrorState onRetry={() => void profile.refetch()} />;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Job Seeker"
        title="My profile / resume"
        description="Update your contact details and preferred resume used when you apply."
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
            Sign-in email. Confirmation and password reset messages are sent here.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={mailing || !(profile.data?.email || user?.email)}
            onClick={() => {
              const email = profile.data?.email || user?.email;
              if (!email) return;
              setMailing(true);
              void (async () => {
                try {
                  await sendPasswordRecoveryEmail(email, window.location.origin);
                  const mailed = await mailAccount({
                    data: { to: email, kind: "reset", origin: window.location.origin },
                  });
                  toast.success("Check your email", {
                    description: mailed.ok
                      ? `A password reset email is on the way to ${email}.`
                      : mailed.message,
                  });
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Could not send the account email.");
                } finally {
                  setMailing(false);
                }
              })();
            }}
          >
            {mailing ? "Sending…" : "Email me a reset link"}
          </Button>
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

        {id && (
          <ResumePdfPicker
            seekerId={id}
            canPersist={canPersist}
            initial={resumeValue}
            onChange={setResumeValue}
          />
        )}

        {!canPersist && (
          <div className="space-y-2">
            <Label htmlFor="resume_url">Resume URL (legacy)</Label>
            <Input id="resume_url" placeholder="https://…" {...form.register("resume_url")} />
            {form.formState.errors.resume_url && (
              <p className="text-xs text-destructive">{form.formState.errors.resume_url.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {profile.data?.resumeSource === "application" && profile.data.latestJobTitle
                ? `Currently prefilled from your application to ${profile.data.latestJobTitle}.`
                : "Used to prefill applications until PDF Storage is enabled."}
            </p>
          </div>
        )}

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
