import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bot, Copy, Mail, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";
import {
  RecruiterAgentEmpty,
  RecruiterAgentError,
  RecruiterAgentLoading,
  RecruiterAgentSuccess,
} from "@/components/recruiter/RecruiterAgentFeedback";
import { CardSkeleton, ErrorState, PageHeader } from "@/components/feedback/States";
import { StatusBadge } from "@/components/status/StatusBadge";
import type { ApplicationStatus } from "@/components/status/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { askRecruiterAgent } from "@/lib/ai/ask-recruiter-agent";
import {
  htmlToEditablePlain,
  parseOutreachAgentResult,
  parseShortlistAgentResult,
} from "@/lib/ai/recruiter-agent-ui";
import { useAuth } from "@/lib/auth";
import { fmtDate, supabase } from "@/components/dashboard/parts";

export const Route = createFileRoute("/_app/recruiter/agent")({
  head: () => ({
    meta: [
      { title: "AI Recruiter Agent — HireHub" },
      {
        name: "description",
        content: "Shortlist applicants and draft outreach via the HireHub Supervisor.",
      },
    ],
  }),
  component: RecruiterAgentPage,
});

type ApplicantRow = {
  id: string;
  status: ApplicationStatus;
  created_at: string;
  seeker_id: string;
  jobs: { id: string; title: string; recruiter_id: string } | null;
  profiles: { full_name: string | null; email: string | null } | null;
};

function RecruiterAgentPage() {
  const { user } = useAuth();
  const id = user?.id;
  const qc = useQueryClient();
  const ask = useServerFn(askRecruiterAgent);

  const [jobId, setJobId] = useState<string>("");
  const [selectedAppId, setSelectedAppId] = useState<string>("");
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [outreachNote, setOutreachNote] = useState<string | null>(null);

  const jobs = useQuery({
    queryKey: ["recruiter-jobs-lite", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id,title,status")
        .eq("recruiter_id", id!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const apps = useQuery({
    queryKey: ["recruiter-agent-applicants", id, jobId],
    enabled: !!id && !!jobId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("id,status,created_at,seeker_id,jobs!inner(id,title,recruiter_id),profiles(full_name,email)")
        .eq("jobs.recruiter_id", id!)
        .eq("job_id", jobId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ApplicantRow[];
    },
  });

  const selectedApp = useMemo(
    () => apps.data?.find((a) => a.id === selectedAppId) ?? null,
    [apps.data, selectedAppId],
  );

  const shortlist = useMutation({
    mutationFn: async (input: { applicationId: string; confirm: boolean }) => {
      const result = await ask({
        data: {
          action: "shortlist" as const,
          applicationId: input.applicationId,
          status: "shortlisted" as const,
          confirm: input.confirm,
        },
      });
      return parseShortlistAgentResult(result);
    },
    onSuccess: async (parsed) => {
      if (parsed.kind === "error") {
        toast.error("Shortlist failed", { description: parsed.message });
        return;
      }
      if (parsed.needsConfirm) {
        toast.message("Confirm required", { description: parsed.message });
        return;
      }
      toast.success("Applicant shortlisted");
      await qc.invalidateQueries({ queryKey: ["recruiter-agent-applicants"] });
      await qc.invalidateQueries({ queryKey: ["recruiter-applicants"] });
      await qc.invalidateQueries({ queryKey: ["recruiter-pipeline-counts"] });
      await qc.invalidateQueries({ queryKey: ["dash-counts"] });
    },
    onError: (e: Error) => toast.error("Shortlist failed", { description: e.message }),
  });

  const outreach = useMutation({
    mutationFn: async (ownedJobId: string) => {
      const result = await ask({
        data: {
          action: "draft_outreach" as const,
          jobId: ownedJobId,
          confirmSend: false,
        },
      });
      return parseOutreachAgentResult(result);
    },
    onSuccess: (parsed) => {
      if (parsed.kind === "error") {
        toast.error("Draft failed", { description: parsed.message });
        setOutreachNote(null);
        return;
      }
      setDraftSubject(parsed.subject);
      setDraftBody(htmlToEditablePlain(parsed.htmlBody));
      setOutreachNote(parsed.message);
      toast.success("Outreach draft ready");
    },
    onError: (e: Error) => toast.error("Draft failed", { description: e.message }),
  });

  const shortlistParsed = shortlist.data;
  const outreachParsed = outreach.data;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Recruiter"
        title="AI Recruiter Agent"
        description="Shortlist applicants and draft outreach through HireHub’s Supervisor. Ownership stays on the server — emails are never sent from this page."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/recruiter/applicants">
              <Users /> Applicants
            </Link>
          </Button>
        }
      />

      <section className="space-y-3 rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Bot className="size-4 text-signal" aria-hidden />
          Choose an owned job
        </div>
        {jobs.isLoading ? (
          <CardSkeleton rows={1} />
        ) : jobs.isError ? (
          <ErrorState onRetry={() => void jobs.refetch()} />
        ) : !jobs.data?.length ? (
          <div className="space-y-3">
            <RecruiterAgentEmpty
              title="No jobs yet"
              description="Post a job you own before using the Recruiter Agent."
            />
            <Button variant="signal" size="sm" asChild>
              <Link to="/recruiter/jobs/new">Post a job</Link>
            </Button>
          </div>
        ) : (
          <Select
            value={jobId || undefined}
            onValueChange={(v) => {
              setJobId(v);
              setSelectedAppId("");
              setDraftSubject("");
              setDraftBody("");
              setOutreachNote(null);
              shortlist.reset();
              outreach.reset();
            }}
          >
            <SelectTrigger className="max-w-xl">
              <SelectValue placeholder="Select a job you own" />
            </SelectTrigger>
            <SelectContent>
              {jobs.data.map((j) => (
                <SelectItem key={j.id} value={j.id}>
                  {j.title} ({j.status})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
          <div className="space-y-1">
            <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <Sparkles className="size-4 text-signal" aria-hidden />
              Candidate shortlisting
            </h2>
            <p className="text-xs text-muted-foreground">
              Applicants load for the selected owned job (JWT). Shortlist runs through the Supervisor with a confirm step.
            </p>
          </div>

          {!jobId ? (
            <RecruiterAgentEmpty title="Select a job" description="Pick an owned job to load applicants." />
          ) : apps.isLoading ? (
            <RecruiterAgentLoading label="Loading applicants…" />
          ) : apps.isError ? (
            <ErrorState onRetry={() => void apps.refetch()} />
          ) : !apps.data?.length ? (
            <RecruiterAgentEmpty
              title="No applicants for this job"
              description="When seekers apply, they will appear here for shortlisting."
            />
          ) : (
            <ul className="divide-y overflow-hidden rounded-2xl border">
              {apps.data.map((app) => {
                const name = app.profiles?.full_name?.trim() || "Applicant";
                const active = selectedAppId === app.id;
                return (
                  <li key={app.id}>
                    <button
                      type="button"
                      className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-signal-soft/40 ${active ? "bg-signal-soft/50" : ""}`}
                      onClick={() => setSelectedAppId(app.id)}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{name}</p>
                        <p className="text-xs text-muted-foreground">Applied {fmtDate(app.created_at)}</p>
                      </div>
                      <StatusBadge status={app.status} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {selectedApp && (
            <div className="space-y-3 rounded-2xl border bg-muted/20 px-4 py-3">
              <p className="text-sm">
                Shortlist{" "}
                <span className="font-medium">
                  {selectedApp.profiles?.full_name?.trim() || "this applicant"}
                </span>
                ?
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={shortlist.isPending}
                  onClick={() =>
                    shortlist.mutate({ applicationId: selectedApp.id, confirm: false })
                  }
                >
                  Propose shortlist
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="signal"
                  disabled={shortlist.isPending}
                  onClick={() =>
                    shortlist.mutate({ applicationId: selectedApp.id, confirm: true })
                  }
                >
                  Confirm shortlist
                </Button>
              </div>
            </div>
          )}

          {shortlist.isPending && <RecruiterAgentLoading label="Running shortlist via Supervisor…" />}
          {shortlistParsed?.kind === "error" && (
            <RecruiterAgentError
              message={shortlistParsed.message}
              onRetry={
                selectedApp
                  ? () => shortlist.mutate({ applicationId: selectedApp.id, confirm: true })
                  : undefined
              }
            />
          )}
          {shortlistParsed?.kind === "shortlist" && shortlistParsed.needsConfirm && (
            <RecruiterAgentSuccess message={shortlistParsed.message} />
          )}
          {shortlistParsed?.kind === "shortlist" && !shortlistParsed.needsConfirm && (
            <RecruiterAgentSuccess
              message={`${shortlistParsed.message} Status: ${shortlistParsed.plannedStatus}.`}
            />
          )}
        </section>

        <section className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
          <div className="space-y-1">
            <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <Mail className="size-4 text-signal" aria-hidden />
              Outreach drafting
            </h2>
            <p className="text-xs text-muted-foreground">
              Draft only — this page always sends <code className="text-[11px]">confirmSend: false</code>. Review and edit locally; nothing is emailed automatically.
            </p>
          </div>

          {!jobId ? (
            <RecruiterAgentEmpty title="Select a job" description="Draft outreach for an owned job." />
          ) : (
            <Button
              type="button"
              size="sm"
              variant="signal"
              disabled={outreach.isPending}
              onClick={() => outreach.mutate(jobId)}
            >
              Draft outreach
            </Button>
          )}

          {outreach.isPending && <RecruiterAgentLoading label="Drafting outreach via Supervisor…" />}
          {outreachParsed?.kind === "error" && (
            <RecruiterAgentError
              message={outreachParsed.message}
              onRetry={jobId ? () => outreach.mutate(jobId) : undefined}
            />
          )}
          {outreachNote && <RecruiterAgentSuccess message={outreachNote} />}

          {(draftSubject || draftBody) && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="outreach-subject">
                  Subject
                </label>
                <Input
                  id="outreach-subject"
                  value={draftSubject}
                  onChange={(e) => setDraftSubject(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="outreach-body">
                  Body (editable)
                </label>
                <Textarea
                  id="outreach-body"
                  rows={10}
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={async () => {
                  const text = `${draftSubject}\n\n${draftBody}`;
                  try {
                    await navigator.clipboard.writeText(text);
                    toast.success("Draft copied");
                  } catch {
                    toast.error("Could not copy draft");
                  }
                }}
              >
                <Copy /> Copy draft
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
