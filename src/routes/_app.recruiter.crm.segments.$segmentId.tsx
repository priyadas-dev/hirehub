import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, UserMinus, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { isCrmSegmentId, segmentTypeLabel } from "@/lib/crm/manual-segments";
import {
  CRM_MANUAL_SEGMENTS_PENDING_MESSAGE,
  CRM_SCHEMA_PENDING_MESSAGE,
  probeCrmManualSegmentsReady,
  probeCrmSchemaReady,
} from "@/lib/crm/schema-probe";
import {
  addContactsToManualSegment,
  fetchManualSegmentDetail,
  removeContactsFromManualSegment,
  renameCrmSegment,
} from "@/lib/crm/segments.server";
import { listCrmContacts } from "@/lib/crm/supabase-crm";

export const Route = createFileRoute("/_app/recruiter/crm/segments/$segmentId")({
  head: () => ({
    meta: [{ title: "Segment — HireHub CRM" }],
  }),
  component: CrmSegmentDetailPage,
});

function CrmSegmentDetailPage() {
  const { segmentId } = Route.useParams();
  const { user } = useAuth();
  const id = user?.id;
  const qc = useQueryClient();

  const loadDetail = useServerFn(fetchManualSegmentDetail);
  const rename = useServerFn(renameCrmSegment);
  const addMembers = useServerFn(addContactsToManualSegment);
  const removeMembers = useServerFn(removeContactsFromManualSegment);

  const [name, setName] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [pickIds, setPickIds] = useState<Set<string>>(new Set());

  const ready = useQuery({ queryKey: ["crm-schema-ready"], queryFn: probeCrmSchemaReady });
  const manualReady = useQuery({
    queryKey: ["crm-manual-segments-ready"],
    queryFn: probeCrmManualSegmentsReady,
    enabled: ready.data === true,
  });

  const validSegmentId = isCrmSegmentId(segmentId);

  const detail = useQuery({
    queryKey: ["crm-segment-detail", segmentId],
    enabled: ready.data === true && validSegmentId,
    queryFn: () => loadDetail({ data: { segmentId } }),
  });

  const allContacts = useQuery({
    queryKey: ["crm-contacts", id],
    enabled: !!id && addOpen,
    queryFn: () => listCrmContacts(id!),
  });

  useEffect(() => {
    if (detail.data?.segment) setName(detail.data.segment.name);
  }, [detail.data?.segment]);

  const saveName = useMutation({
    mutationFn: () => rename({ data: { segmentId, name: name.trim() } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["crm-segment-detail", segmentId] });
      void qc.invalidateQueries({ queryKey: ["crm-segments", id] });
      toast.success("Segment renamed");
    },
    onError: (e: Error) => toast.error(e.message || "Rename failed"),
  });

  const add = useMutation({
    mutationFn: () => addMembers({ data: { segmentId, contactIds: [...pickIds] } }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["crm-segment-detail", segmentId] });
      void qc.invalidateQueries({ queryKey: ["crm-segments", id] });
      toast.success(`Added ${r.added} contact${r.added === 1 ? "" : "s"}`);
      setPickIds(new Set());
      setAddOpen(false);
    },
    onError: (e: Error) => toast.error(e.message || "Could not add contacts"),
  });

  const remove = useMutation({
    mutationFn: (contactIds: string[]) => removeMembers({ data: { segmentId, contactIds } }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["crm-segment-detail", segmentId] });
      void qc.invalidateQueries({ queryKey: ["crm-segments", id] });
      toast.success(`Removed ${r.removed} contact${r.removed === 1 ? "" : "s"}`);
    },
    onError: (e: Error) => toast.error(e.message || "Could not remove contacts"),
  });

  const memberIds = useMemo(() => new Set(detail.data?.memberContactIds ?? []), [detail.data?.memberContactIds]);

  const addCandidates = useMemo(() => {
    return (allContacts.data ?? []).filter((c) => !memberIds.has(c.id));
  }, [allContacts.data, memberIds]);

  if (ready.isLoading) return <CardSkeleton rows={4} />;
  if (ready.data === false) {
    return (
      <EmptyState icon={ArrowLeft} title="CRM schema not applied" description={CRM_SCHEMA_PENDING_MESSAGE} />
    );
  }
  if (validSegmentId && !detail.isFetched && !detail.isError) return <CardSkeleton rows={5} />;
  if (validSegmentId && detail.isError) return <ErrorState onRetry={() => void detail.refetch()} />;
  if (!validSegmentId || !detail.data?.segment) {
    return (
      <EmptyState
        icon={ArrowLeft}
        title="Segment not found"
        description="This segment may have been removed."
        action={
          <Button asChild variant="outline">
            <Link to="/recruiter/crm/segments">All segments</Link>
          </Button>
        }
      />
    );
  }

  const segment = detail.data.segment;
  const isManual = segment.segmentType === "manual";

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Recruiter"
        title={segment.name}
        description="Manage segment membership and name."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/recruiter/crm/segments">
              <ArrowLeft className="mr-1.5 size-4" />
              All segments
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Badge variant={isManual ? "default" : "secondary"}>{segmentTypeLabel(segment.segmentType)}</Badge>
        <span>·</span>
        <span>{detail.data.members.length} contacts</span>
        <span>·</span>
        <span>kind: {segment.kind}</span>
      </div>

      <section className="surface-card space-y-3 p-5 sm:p-6">
        <h2 className="text-sm font-semibold">Rename segment</h2>
        <div className="flex flex-wrap gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} className="max-w-md" aria-label="Segment name" />
          <Button disabled={!name.trim() || saveName.isPending} onClick={() => saveName.mutate()}>
            Save name
          </Button>
        </div>
      </section>

      {isManual && manualReady.data === false && (
        <p className="text-sm text-amber-700 dark:text-amber-400">{CRM_MANUAL_SEGMENTS_PENDING_MESSAGE}</p>
      )}

      {isManual ? (
        manualReady.data === false ? null : (
        <>
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Contacts in this segment</h2>
              <Button variant="outline" size="sm" onClick={() => setAddOpen((o) => !o)}>
                <UserPlus className="mr-1.5 size-4" />
                Add contacts
              </Button>
            </div>

            {addOpen && (
              <div className="surface-card space-y-3 p-4">
                <p className="text-xs text-muted-foreground">Select existing CRM contacts — no email typing.</p>
                {allContacts.isLoading ? (
                  <CardSkeleton rows={2} />
                ) : addCandidates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">All your contacts are already in this segment.</p>
                ) : (
                  <ul className="max-h-48 space-y-2 overflow-y-auto">
                    {addCandidates.map((c) => (
                      <li key={c.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={pickIds.has(c.id)}
                          onCheckedChange={(v) => {
                            setPickIds((prev) => {
                              const next = new Set(prev);
                              if (v === true) next.add(c.id);
                              else next.delete(c.id);
                              return next;
                            });
                          }}
                        />
                        <span className="font-medium">{c.fullName || c.email}</span>
                        <span className="text-muted-foreground">{c.email}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <Button disabled={pickIds.size === 0 || add.isPending} onClick={() => add.mutate()}>
                  Add selected
                </Button>
              </div>
            )}

            {detail.data.members.length === 0 ? (
              <EmptyState icon={UserPlus} title="No contacts yet" description="Add contacts from your CRM list." />
            ) : (
              <ul className="divide-y rounded-xl border bg-card">
                {detail.data.members.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="font-medium">{c.fullName || c.email}</p>
                      <p className="text-xs text-muted-foreground">{c.email}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate([c.id])}
                    >
                      <UserMinus className="mr-1 size-4" />
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
        )
      ) : (
        <section className="surface-card space-y-2 p-5 sm:p-6">
          <h2 className="text-sm font-semibold">Filter criteria</h2>
          <p className="text-xs text-muted-foreground">This is a filter-based segment (automatic rules arrive in a later phase).</p>
          <pre className="overflow-x-auto rounded-lg bg-muted/40 p-3 text-xs">{JSON.stringify(segment.filter, null, 2)}</pre>
          <p className="text-sm text-muted-foreground">
            Matching contacts: {detail.data.members.length} (resolved from filters on the Segments list)
          </p>
        </section>
      )}
    </div>
  );
}
