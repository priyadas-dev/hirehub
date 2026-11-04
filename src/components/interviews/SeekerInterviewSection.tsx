import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  formatInterviewRange,
  formatInterviewResponseLabel,
  isDisplayableMeetLink,
} from "@/lib/integrations/interview-display";
import { probeInterviewScheduleSchemaReady } from "@/lib/integrations/interview-schema-probe";
import { fetchSeekerScheduledInterview } from "@/lib/integrations/interview-schedules.client";

type Props = {
  applicationId: string;
};

export function SeekerInterviewSection({ applicationId }: Props) {
  const schemaReady = useQuery({
    queryKey: ["interview-schema-ready"],
    queryFn: probeInterviewScheduleSchemaReady,
  });

  const interview = useQuery({
    queryKey: ["seeker-interview", applicationId],
    enabled: schemaReady.data === true,
    queryFn: () => fetchSeekerScheduledInterview(applicationId),
    refetchInterval: 60_000,
  });

  if (schemaReady.isLoading || schemaReady.data === false) {
    return null;
  }

  if (interview.isLoading || interview.isError || !interview.data) {
    return null;
  }

  const row = interview.data;
  if (row.status !== "scheduled" || !isDisplayableMeetLink(row.meet_link)) {
    return null;
  }

  return (
    <section className="surface-card space-y-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Your interview</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Join with the Google Meet link below. Times follow the timezone shown.
          </p>
        </div>
        <Badge variant="default" className="gap-1">
          <CalendarClock className="size-3.5" />
          Scheduled
        </Badge>
      </div>

      <p className="text-sm font-medium">
        {formatInterviewRange({
          startAt: row.start_at,
          endAt: row.end_at,
          timeZone: row.timezone,
        })}
      </p>

      <div className="space-y-2 text-sm">
        <p className="text-muted-foreground">Your response</p>
        <p className="font-medium">{formatInterviewResponseLabel(row.seeker_response)}</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button variant="signal" asChild>
          <a href={row.meet_link} target="_blank" rel="noopener noreferrer">
            <Video />
            Join Google Meet
          </a>
        </Button>
        {row.html_link && (
          <Button variant="outline" size="sm" asChild>
            <a href={row.html_link} target="_blank" rel="noopener noreferrer">
              Open in Google Calendar
            </a>
          </Button>
        )}
      </div>
    </section>
  );
}
