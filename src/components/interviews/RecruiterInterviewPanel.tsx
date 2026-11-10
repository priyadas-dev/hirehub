import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, Loader2, Video } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ApplicationStatus } from "@/components/status/status";
import {
  datetimeLocalInZoneToIso,
  defaultInterviewDatetimeLocalInputs,
  formatInterviewRange,
  formatInterviewResponseLabel,
  isDisplayableMeetLink,
  isoToDatetimeLocalInZone,
} from "@/lib/integrations/interview-display";
import { DEFAULT_INTERVIEW_TIMEZONE } from "@/lib/integrations/google-calendar";
import { isSchedulableApplicationStatus } from "@/lib/integrations/interview-authorization";
import {
  INTERVIEW_SCHEMA_PENDING_MESSAGE,
  probeInterviewScheduleSchemaReady,
} from "@/lib/integrations/interview-schema-probe";
import {
  cancelInterviewSchedule,
  loadOpenInterviewScheduleForApplication,
  rescheduleInterview,
  retryInterviewSchedule,
  scheduleInterview,
} from "@/lib/integrations/interview-schedule.server";

type Props = {
  applicationId: string;
  applicationStatus: ApplicationStatus;
};

function statusTone(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "scheduled") return "default";
  if (status === "failed") return "destructive";
  return "secondary";
}

export function RecruiterInterviewPanel({ applicationId, applicationStatus }: Props) {
  const qc = useQueryClient();
  const scheduleInterviewFn = useServerFn(scheduleInterview);
  const retryInterviewFn = useServerFn(retryInterviewSchedule);
  const rescheduleInterviewFn = useServerFn(rescheduleInterview);
  const cancelInterviewFn = useServerFn(cancelInterviewSchedule);
  const loadScheduleFn = useServerFn(loadOpenInterviewScheduleForApplication);
  const schedulable = isSchedulableApplicationStatus(applicationStatus);
  const defaults = useMemo(() => defaultInterviewDatetimeLocalInputs(), []);

  const schemaReady = useQuery({
    queryKey: ["interview-schema-ready"],
    queryFn: probeInterviewScheduleSchemaReady,
  });

  const schedule = useQuery({
    queryKey: ["interview-schedule", applicationId],
    enabled: schemaReady.data === true && schedulable,
    queryFn: () => loadScheduleFn({ data: { applicationId } }),
    refetchInterval: (q) => (q.state.data?.status === "pending" ? 5000 : false),
  });

  const [startLocal, setStartLocal] = useState(defaults.startLocal);
  const [endLocal, setEndLocal] = useState(defaults.endLocal);
  const [notes, setNotes] = useState("");
  const [rescheduleMode, setRescheduleMode] = useState(false);

  useEffect(() => {
    setRescheduleMode(false);
    setNotes("");
    const d = defaultInterviewDatetimeLocalInputs();
    setStartLocal(d.startLocal);
    setEndLocal(d.endLocal);
  }, [applicationId]);

  useEffect(() => {
    const data = schedule.data;
    if (!data || rescheduleMode) return;
    setStartLocal(isoToDatetimeLocalInZone(data.start_at, data.timezone));
    setEndLocal(isoToDatetimeLocalInZone(data.end_at, data.timezone));
  }, [schedule.data, rescheduleMode]);

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ["interview-schedule", applicationId] });
    await qc.invalidateQueries({ queryKey: ["seeker-interview", applicationId] });
  };

  const runAction = useMutation({
    mutationFn: async (input: {
      run: () => Promise<{ ok: boolean; message?: string }>;
      successMessage: string;
    }) => {
      const result = await input.run();
      if (!result.ok) {
        throw new Error(result.message ?? "Interview action failed");
      }
      return input.successMessage;
    },
    onSuccess: async (message) => {
      toast.success(message);
      await invalidate();
    },
    onError: (e: Error) => toast.error("Interview", { description: e.message }),
  });

  if (schemaReady.isLoading) {
    return (
      <div className="space-y-2 border-t pt-6">
        <p className="text-sm font-medium">Interview</p>
        <p className="text-sm text-muted-foreground">Checking scheduling availability…</p>
      </div>
    );
  }

  if (schemaReady.data === false) {
    return (
      <div className="space-y-2 border-t pt-6">
        <p className="text-sm font-medium">Interview</p>
        <Alert>
          <CalendarClock className="size-4" />
          <AlertTitle>Scheduling not available yet</AlertTitle>
          <AlertDescription>{INTERVIEW_SCHEMA_PENDING_MESSAGE}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!schedulable) {
    return (
      <div className="space-y-2 border-t pt-6">
        <p className="text-sm font-medium">Interview</p>
        <p className="text-sm text-muted-foreground">
          Shortlist this applicant (or move them to Interview) before scheduling a Google Meet
          interview.
        </p>
      </div>
    );
  }

  const row = schedule.data;
  const busy = runAction.isPending;

  const scheduleNew = () =>
    runAction.mutate({
      successMessage: "Interview scheduling started",
      run: () =>
        scheduleInterviewFn({
          data: {
            applicationId,
            startAt: datetimeLocalInZoneToIso(startLocal),
            endAt: datetimeLocalInZoneToIso(endLocal),
            timezone: DEFAULT_INTERVIEW_TIMEZONE,
            ...(notes.trim() ? { notes: notes.trim() } : {}),
          },
        }),
    });

  const retryMeet = () =>
    row &&
    runAction.mutate({
      successMessage: "Retrying Meet link",
      run: () => retryInterviewFn({ data: { scheduleId: row.id } }),
    });

  const reschedule = () =>
    row &&
    runAction.mutate({
      successMessage: "Interview rescheduled",
      run: async () => {
        const result = await rescheduleInterviewFn({
          data: {
            scheduleId: row.id,
            startAt: datetimeLocalInZoneToIso(startLocal),
            endAt: datetimeLocalInZoneToIso(endLocal),
            timezone: DEFAULT_INTERVIEW_TIMEZONE,
          },
        });
        if (result.ok) setRescheduleMode(false);
        return result;
      },
    });

  const cancel = () =>
    row &&
    runAction.mutate({
      successMessage: "Interview cancelled",
      run: () => cancelInterviewFn({ data: { scheduleId: row.id } }),
    });

  return (
    <div className="space-y-4 border-t pt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Google Calendar interview</p>
        {row && (
          <Badge variant={statusTone(row.status)}>
            {row.status === "pending"
              ? "Setting up Meet"
              : row.status === "failed"
                ? "Meet setup failed"
                : "Scheduled"}
          </Badge>
        )}
      </div>

      {schedule.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading interview…</p>
      ) : schedule.isError ? (
        <p className="text-sm text-destructive">Could not load interview details.</p>
      ) : !row ? (
        <>
          <p className="text-sm text-muted-foreground">
            Creates a Google Calendar event with Meet. Invitations send only after Google returns a
            real Meet link ({DEFAULT_INTERVIEW_TIMEZONE}).
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`int-start-${applicationId}`}>Start</Label>
              <Input
                id={`int-start-${applicationId}`}
                type="datetime-local"
                value={startLocal}
                disabled={busy}
                onChange={(e) => setStartLocal(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`int-end-${applicationId}`}>End</Label>
              <Input
                id={`int-end-${applicationId}`}
                type="datetime-local"
                value={endLocal}
                disabled={busy}
                onChange={(e) => setEndLocal(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`int-notes-${applicationId}`}>Notes for calendar (optional)</Label>
            <Textarea
              id={`int-notes-${applicationId}`}
              rows={2}
              maxLength={2000}
              disabled={busy}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <Button variant="signal" size="sm" disabled={busy} onClick={() => scheduleNew()}>
            {busy ? (
              <>
                <Loader2 className="animate-spin" /> Scheduling…
              </>
            ) : (
              <>
                <Video /> Schedule interview
              </>
            )}
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {formatInterviewRange({
              startAt: row.start_at,
              endAt: row.end_at,
              timeZone: row.timezone,
            })}
          </p>

          {row.status === "scheduled" && (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Your RSVP</dt>
                <dd className="font-medium">
                  {formatInterviewResponseLabel(row.recruiter_response)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Candidate RSVP</dt>
                <dd className="font-medium">{formatInterviewResponseLabel(row.seeker_response)}</dd>
              </div>
            </dl>
          )}

          {isDisplayableMeetLink(row.meet_link) && (
            <p className="text-sm">
              <a
                className="break-all text-signal underline"
                href={row.meet_link}
                target="_blank"
                rel="noopener noreferrer"
              >
                {row.meet_link}
              </a>
            </p>
          )}

          {row.status === "pending" && (
            <p className="text-sm text-muted-foreground">
              Google is creating the Meet link. This page refreshes automatically; invitations go
              out when the link is ready.
            </p>
          )}

          {row.status === "failed" && row.failure_reason && (
            <p className="text-sm text-destructive">{row.failure_reason}</p>
          )}

          {row.status === "pending" && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => scheduleNew()}>
              {busy ? "Working…" : "Retry setup"}
            </Button>
          )}

          {row.status === "failed" && (
            <div className="flex flex-wrap gap-2">
              <Button variant="signal" size="sm" disabled={busy} onClick={() => retryMeet()}>
                Retry Meet link
                {row.conference_attempt > 1 ? ` (attempt ${row.conference_attempt})` : ""}
              </Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => cancel()}>
                Cancel interview
              </Button>
            </div>
          )}

          {row.status === "scheduled" && (
            <div className="space-y-3">
              {rescheduleMode ? (
                <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                  <p className="text-sm font-medium">Reschedule</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor={`rs-start-${applicationId}`}>New start</Label>
                      <Input
                        id={`rs-start-${applicationId}`}
                        type="datetime-local"
                        value={startLocal}
                        disabled={busy}
                        onChange={(e) => setStartLocal(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`rs-end-${applicationId}`}>New end</Label>
                      <Input
                        id={`rs-end-${applicationId}`}
                        type="datetime-local"
                        value={endLocal}
                        disabled={busy}
                        onChange={(e) => setEndLocal(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="signal" size="sm" disabled={busy} onClick={() => reschedule()}>
                      Save new time
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => setRescheduleMode(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setRescheduleMode(true)}
                  >
                    Reschedule
                  </Button>
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => cancel()}>
                    Cancel interview
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
