import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { CRM_SCHEMA_PENDING_MESSAGE, probeCrmSchemaReady } from "@/lib/crm/schema-probe";
import { createCrmCampaign, listCrmCampaigns, listCrmSegments } from "@/lib/crm/supabase-crm";

export const Route = createFileRoute("/_app/recruiter/crm/campaigns/")({
  head: () => ({
    meta: [{ title: "CRM campaigns — HireHub" }],
  }),
  component: CrmCampaignsPage,
});

function CrmCampaignsPage() {
  const { user } = useAuth();
  const id = user?.id;
  const qc = useQueryClient();
  const navigate = Route.useNavigate();

  const [name, setName] = useState("");
  const [segmentId, setSegmentId] = useState<string>("");

  const ready = useQuery({ queryKey: ["crm-schema-ready"], queryFn: probeCrmSchemaReady });

  const campaigns = useQuery({
    queryKey: ["crm-campaigns", id],
    enabled: !!id && ready.data === true,
    queryFn: () => listCrmCampaigns(id!),
  });

  const segments = useQuery({
    queryKey: ["crm-segments", id],
    enabled: !!id && ready.data === true,
    queryFn: () => listCrmSegments(id!),
  });

  const create = useMutation({
    mutationFn: () =>
      createCrmCampaign({
        recruiterId: id!,
        name,
        segmentId: segmentId || null,
      }),
    onSuccess: (campaign) => {
      void qc.invalidateQueries({ queryKey: ["crm-campaigns", id] });
      toast.success("Campaign draft created");
      void navigate({ to: "/recruiter/crm/campaigns/$campaignId", params: { campaignId: campaign.id } });
    },
    onError: (e: Error) => toast.error(e.message || "Could not create campaign"),
  });

  if (ready.isLoading) return <CardSkeleton rows={4} />;
  if (ready.data === false) {
    return (
      <>
        <PageHeader eyebrow="Recruiter" title="Campaigns" description="Email outreach via Resend." />
        <EmptyState icon={Megaphone} title="CRM schema not applied" description={CRM_SCHEMA_PENDING_MESSAGE} />
      </>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Recruiter"
        title="Campaigns"
        description="Preview content, confirm, then send. Tracking updates from the Resend webhook."
      />

      <section className="surface-card space-y-4 p-5 sm:p-6">
        <h2 className="text-sm font-semibold">New campaign</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="camp-name">Name</Label>
            <Input id="camp-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Audience segment</Label>
            <Select value={segmentId} onValueChange={setSegmentId}>
              <SelectTrigger>
                <SelectValue placeholder="Select segment" />
              </SelectTrigger>
              <SelectContent>
                {(segments.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({s.kind})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
          Create draft
        </Button>
      </section>

      {campaigns.isLoading ? (
        <CardSkeleton rows={3} />
      ) : campaigns.isError ? (
        <ErrorState onRetry={() => void campaigns.refetch()} />
      ) : (campaigns.data?.length ?? 0) === 0 ? (
        <EmptyState icon={Megaphone} title="No campaigns" description="Create a draft to start outreach." />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {campaigns.data!.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="font-medium">{c.name}</p>
                <p className="text-xs text-muted-foreground">
                  {c.status} · {c.subject || "No subject yet"}
                </p>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link to="/recruiter/crm/campaigns/$campaignId" params={{ campaignId: c.id }}>
                  Open
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
