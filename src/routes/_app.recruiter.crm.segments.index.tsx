import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Filter } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { segmentTypeLabel } from "@/lib/crm/manual-segments";
import { resolveSegmentAudience } from "@/lib/crm/segments";
import {
  CRM_SCHEMA_PENDING_MESSAGE,
  probeCrmManualSegmentsReady,
  probeCrmSchemaReady,
} from "@/lib/crm/schema-probe";
import { createCrmSegment, listCrmContacts, listCrmSegmentMembersByRecruiter, listCrmSegments } from "@/lib/crm/supabase-crm";
import type { CrmSegmentKind } from "@/lib/crm/types";

export const Route = createFileRoute("/_app/recruiter/crm/segments/")({
  head: () => ({
    meta: [{ title: "CRM segments — HireHub" }],
  }),
  component: CrmSegmentsPage,
});

function CrmSegmentsPage() {
  const { user } = useAuth();
  const id = user?.id;
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [kind, setKind] = useState<CrmSegmentKind>("new");
  const [skills, setSkills] = useState("");
  const [statuses, setStatuses] = useState("");

  const ready = useQuery({ queryKey: ["crm-schema-ready"], queryFn: probeCrmSchemaReady });
  const manualReady = useQuery({
    queryKey: ["crm-manual-segments-ready"],
    queryFn: probeCrmManualSegmentsReady,
    enabled: ready.data === true,
  });

  const segments = useQuery({
    queryKey: ["crm-segments", id],
    enabled: !!id && ready.data === true,
    queryFn: () => listCrmSegments(id!),
  });

  const contacts = useQuery({
    queryKey: ["crm-contacts", id],
    enabled: !!id && ready.data === true,
    queryFn: () => listCrmContacts(id!),
  });

  const memberMap = useQuery({
    queryKey: ["crm-segment-members-map", id],
    enabled: !!id && ready.data === true && manualReady.data === true,
    queryFn: () => listCrmSegmentMembersByRecruiter(id!),
  });

  const create = useMutation({
    mutationFn: () =>
      createCrmSegment({
        recruiterId: id!,
        name,
        kind,
        segmentType: "filter",
        filter: {
          segmentKinds: [kind],
          skills: skills.split(",").map((s) => s.trim()).filter(Boolean),
          applicationStatuses: statuses.split(",").map((s) => s.trim()).filter(Boolean),
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["crm-segments", id] });
      void qc.invalidateQueries({ queryKey: ["crm-dashboard", id] });
      toast.success("Filter segment created");
      setName("");
      setSkills("");
      setStatuses("");
    },
    onError: (e: Error) => toast.error(e.message || "Could not create segment"),
  });

  const audienceCounts = useMemo(() => {
    const map = new Map<string, number>();
    const members = memberMap.data;
    for (const seg of segments.data ?? []) {
      if (seg.segmentType === "manual" && members) {
        map.set(seg.id, (members.get(seg.id) ?? []).length);
      } else {
        map.set(seg.id, resolveSegmentAudience(contacts.data ?? [], seg).length);
      }
    }
    return map;
  }, [segments.data, contacts.data, memberMap.data]);

  if (ready.isLoading) return <CardSkeleton rows={4} />;
  if (ready.data === false) {
    return (
      <>
        <PageHeader eyebrow="Recruiter" title="Segments" description="Audience filters for campaigns." />
        <EmptyState icon={Filter} title="CRM schema not applied" description={CRM_SCHEMA_PENDING_MESSAGE} />
      </>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Recruiter"
        title="Segments"
        description="Manual lists from Contacts, or filter-based audiences. Create manual segments from selected contacts on the Contacts tab."
      />

      <section className="surface-card space-y-4 p-5 sm:p-6">
        <h2 className="text-sm font-semibold">Create filter segment</h2>
        <p className="text-xs text-muted-foreground">
          Rule-based filter segments (automatic application-aware segments come in a later phase).
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="seg-name">Name</Label>
            <Input id="seg-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Kind</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as CrmSegmentKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">new</SelectItem>
                <SelectItem value="active">active</SelectItem>
                <SelectItem value="placed">placed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="seg-skills">Skills filter (comma-separated)</Label>
            <Input id="seg-skills" value={skills} onChange={(e) => setSkills(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="seg-status">Application statuses (comma-separated)</Label>
            <Input
              id="seg-status"
              value={statuses}
              onChange={(e) => setStatuses(e.target.value)}
              placeholder="shortlisted,interview"
            />
          </div>
        </div>
        <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
          Save filter segment
        </Button>
      </section>

      {segments.isLoading ? (
        <CardSkeleton rows={3} />
      ) : segments.isError ? (
        <ErrorState onRetry={() => void segments.refetch()} />
      ) : (segments.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={Filter}
          title="No segments"
          description="Create a manual segment from Contacts, or save a filter segment here."
        />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {segments.data!.map((s) => (
            <li key={s.id}>
              <Link
                to="/recruiter/crm/segments/$segmentId"
                params={{ segmentId: s.id }}
                className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{s.name}</p>
                    <Badge variant={s.segmentType === "manual" ? "default" : "secondary"}>
                      {segmentTypeLabel(s.segmentType)}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    kind: {s.kind} · {audienceCounts.get(s.id) ?? 0} contacts
                    {s.segmentType === "manual" && manualReady.data === false ? " · apply PROPOSED_0026 for counts" : ""}
                  </p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
