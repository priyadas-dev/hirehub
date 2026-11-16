import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Megaphone } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { buildCampaignPreview, mergeCampaignDraft, summarizeCampaignTracking } from "@/lib/crm/campaigns";
import { displayCampaignRecipientTracking } from "@/lib/crm/resend-test-fixtures";
import { CRM_SCHEMA_PENDING_MESSAGE, probeCrmSchemaReady } from "@/lib/crm/schema-probe";
import { sendCrmCampaign } from "@/lib/crm/send-campaign.server";
import {
  getCrmCampaign,
  listCrmRecipients,
  listCrmSegments,
  updateCrmCampaign,
} from "@/lib/crm/supabase-crm";

export const Route = createFileRoute("/_app/recruiter/crm/campaigns/$campaignId")({
  head: () => ({
    meta: [{ title: "Campaign — HireHub CRM" }],
  }),
  component: CrmCampaignDetailPage,
});

function CrmCampaignDetailPage() {
  const { campaignId } = Route.useParams();
  const { user } = useAuth();
  const id = user?.id;
  const qc = useQueryClient();
  const send = useServerFn(sendCrmCampaign);

  const [subject, setSubject] = useState("");
  const [htmlBody, setHtmlBody] = useState("");
  const [confirmChecked, setConfirmChecked] = useState(false);
  const contentDirtyRef = useRef(false);

  const ready = useQuery({ queryKey: ["crm-schema-ready"], queryFn: probeCrmSchemaReady });

  const campaign = useQuery({
    queryKey: ["crm-campaign", campaignId],
    enabled: ready.data === true,
    queryFn: () => getCrmCampaign(campaignId),
  });

  const recipients = useQuery({
    queryKey: ["crm-recipients", campaignId],
    enabled: ready.data === true,
    queryFn: () => listCrmRecipients(campaignId),
  });

  const segments = useQuery({
    queryKey: ["crm-segments", id],
    enabled: !!id && ready.data === true,
    queryFn: () => listCrmSegments(id!),
  });

  useEffect(() => {
    contentDirtyRef.current = false;
  }, [campaignId]);

  useEffect(() => {
    if (!campaign.data || contentDirtyRef.current) return;
    setSubject(campaign.data.subject);
    setHtmlBody(campaign.data.htmlBody);
  }, [campaign.data]);

  const save = useMutation({
    mutationFn: () =>
      updateCrmCampaign(campaignId, {
        subject,
        htmlBody,
        status: "ready",
      }),
    onSuccess: () => {
      contentDirtyRef.current = false;
      void qc.invalidateQueries({ queryKey: ["crm-campaign", campaignId] });
      toast.success("Campaign saved");
    },
    onError: (e: Error) => toast.error(e.message || "Save failed"),
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      send({
        data: {
          campaignId,
          confirm: true as const,
          subject,
          htmlBody,
        },
      }),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ["crm-campaign", campaignId] });
      void qc.invalidateQueries({ queryKey: ["crm-recipients", campaignId] });
      void qc.invalidateQueries({ queryKey: ["crm-dashboard", id] });
      if (!result.ok) {
        const missing =
          result.providerMissing && result.providerMissing.length > 0
            ? ` Missing: ${result.providerMissing.join(", ")}.`
            : "";
        toast.error((result.error || "Send failed") + missing, { duration: 10_000 });
        return;
      }
      if (result.alreadySent) toast.message("Campaign already sent (idempotent)");
      else {
        const parts = ["Campaign send finished"];
        if (typeof result.emailsAccepted === "number") {
          parts.push(`${result.emailsAccepted} accepted by Resend`);
        }
        if (typeof result.emailsFailed === "number" && result.emailsFailed > 0) {
          parts.push(`${result.emailsFailed} failed`);
        }
        if (typeof result.emailsSkipped === "number" && result.emailsSkipped > 0) {
          parts.push(`${result.emailsSkipped} skipped`);
        }
        toast.success(parts.join(" · "));
      }
      setConfirmChecked(false);
    },
    onError: (e: Error) => toast.error(e.message || "Send failed"),
  });

  if (ready.isLoading || campaign.isLoading) return <CardSkeleton rows={8} />;
  if (ready.data === false) {
    return <EmptyState icon={Megaphone} title="CRM schema not applied" description={CRM_SCHEMA_PENDING_MESSAGE} />;
  }
  if (campaign.isError) return <ErrorState onRetry={() => void campaign.refetch()} />;
  if (!campaign.data) {
    return (
      <EmptyState
        icon={Megaphone}
        title="Campaign not found"
        description="It may belong to another recruiter or was removed."
        action={
          <Button asChild variant="outline">
            <Link to="/recruiter/crm/campaigns">Back</Link>
          </Button>
        }
      />
    );
  }

  // Ownership guard in UI (server still enforces)
  if (id && campaign.data.recruiterId !== id && user?.role !== "admin") {
    return (
      <EmptyState
        icon={Megaphone}
        title="Access denied"
        description="You cannot open another recruiter's campaign."
      />
    );
  }

  const preview = buildCampaignPreview(mergeCampaignDraft(campaign.data, { subject, htmlBody }));
  const segmentName = segments.data?.find((s) => s.id === campaign.data!.segmentId)?.name ?? "None";
  const tracking = summarizeCampaignTracking(recipients.data ?? []);
  const anyAcceptedByResend = (recipients.data ?? []).some((r) => Boolean(r.resendEmailId));
  const incompleteSend =
    campaign.data.status === "sent" && !anyAcceptedByResend && (recipients.data?.length ?? 0) > 0;
  const canSend = campaign.data.status !== "sent" || incompleteSend;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Campaign"
        title={campaign.data.name}
        description={`Status: ${campaign.data.status} · Audience: ${segmentName}`}
        actions={
          <Button variant="outline" asChild>
            <Link to="/recruiter/crm/campaigns">All campaigns</Link>
          </Button>
        }
      />

      <section className="surface-card space-y-4 p-5 sm:p-6">
        <h2 className="text-sm font-semibold">Content</h2>
        <div className="space-y-1.5">
          <Label htmlFor="subject">Subject</Label>
          <Input
            id="subject"
            value={subject}
            onChange={(e) => {
              contentDirtyRef.current = true;
              setSubject(e.target.value);
            }}
            disabled={campaign.data.status === "sent" && !incompleteSend}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="body">HTML body</Label>
          <Textarea
            id="body"
            rows={8}
            value={htmlBody}
            onChange={(e) => {
              contentDirtyRef.current = true;
              setHtmlBody(e.target.value);
            }}
            disabled={campaign.data.status === "sent" && !incompleteSend}
            placeholder="<p>Hello from HireHub…</p>"
          />
        </div>
        {campaign.data.status !== "sent" && (
          <Button variant="secondary" disabled={save.isPending} onClick={() => save.mutate()}>
            Save draft
          </Button>
        )}
      </section>

      <section className="surface-card space-y-3 p-5 sm:p-6">
        <h2 className="text-sm font-semibold">Preview</h2>
        <p className="text-sm font-medium">{preview.subject || "(no subject)"}</p>
        <div
          className="prose prose-sm max-w-none rounded-lg border bg-background/50 p-4 text-sm"
          dangerouslySetInnerHTML={{ __html: preview.html || "<p class='text-muted-foreground'>Empty body</p>" }}
        />
        {!preview.ready && (
          <p className="text-sm text-destructive">{preview.blockers.join(" · ")}</p>
        )}
      </section>

      {canSend && (
        <section className="surface-card space-y-4 p-5 sm:p-6">
          <h2 className="text-sm font-semibold">
            {incompleteSend ? "Retry send with Resend" : "Send with Resend"}
          </h2>
          {incompleteSend && (
            <p className="text-sm text-destructive">
              Previous send did not reach Resend (recipients still pending/failed). Confirm host secrets
              (`RESEND_API_KEY` + From), redeploy if needed, then retry.
            </p>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={confirmChecked}
              onChange={(e) => setConfirmChecked(e.target.checked)}
            />
            <span>
              I confirm this email should be sent to the selected segment. This action uses HireHub&apos;s
              Resend integration and is idempotent per campaign.
            </span>
          </label>
          <Button
            disabled={!confirmChecked || !preview.ready || sendMutation.isPending}
            onClick={() => sendMutation.mutate()}
          >
            {incompleteSend ? "Confirm & retry send" : "Confirm & send"}
          </Button>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Tracking</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Mini label="Pending" value={tracking.pending} />
          <Mini label="Sent (Resend)" value={tracking.sent} />
          <Mini label="Delivered" value={tracking.delivered} />
          <Mini label="Opened" value={tracking.opened} />
          <Mini label="Bounced" value={tracking.bounced} />
          <Mini label="Complained" value={tracking.complained} />
        </div>
        {(recipients.data?.length ?? 0) > 0 && (
          <ul className="divide-y rounded-xl border bg-card">
            {recipients.data!.map((r) => (
              <li key={r.id} className="flex justify-between gap-3 px-4 py-2 text-sm">
                <span>{r.email}</span>
                <span className="text-muted-foreground">
                  {displayCampaignRecipientTracking(r, campaign.data.status)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums">{value}</p>
    </div>
  );
}
