import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Users } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CreateManualSegmentDialog } from "@/components/crm/CreateManualSegmentDialog";
import { CrmContactDetailSheet } from "@/components/crm/CrmContactDetailSheet";
import { CrmContactsTable } from "@/components/crm/CrmContactsTable";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { STATUS_META, type ApplicationStatus } from "@/components/status/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import type { CrmContactSortDir, CrmContactSortField } from "@/lib/crm/contacts-list";
import { filterContactsForRecruiter } from "@/lib/crm/contacts";
import { collectContactFilterOptions } from "@/lib/crm/contacts-list";
import { fetchCrmContactsPage } from "@/lib/crm/contacts.server";
import {
  CRM_MANUAL_SEGMENTS_PENDING_MESSAGE,
  CRM_SCHEMA_PENDING_MESSAGE,
  probeCrmManualSegmentsReady,
  probeCrmSchemaReady,
} from "@/lib/crm/schema-probe";
import { importApplicantsToCrm } from "@/lib/crm/import-from-applicants.server";
import { setupResendTestFixture } from "@/lib/crm/resend-test-fixtures.server";
import { RESEND_TEST_RECIPIENTS } from "@/lib/crm/resend-test-fixtures";
import { createCrmContact, listCrmContacts } from "@/lib/crm/supabase-crm";
import { softSyncCrmContactHubSpot } from "@/lib/crm/sync-contact.server";
import type { CrmContact, CrmSegmentKind } from "@/lib/crm/types";

export const Route = createFileRoute("/_app/recruiter/crm/contacts")({
  head: () => ({
    meta: [{ title: "CRM contacts — HireHub" }],
  }),
  component: CrmContactsPage,
});

const ALL = "__all__";

function CrmContactsPage() {
  const { user } = useAuth();
  const id = user?.id;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const syncHubSpot = useServerFn(softSyncCrmContactHubSpot);
  const importApplicants = useServerFn(importApplicantsToCrm);
  const fetchPage = useServerFn(fetchCrmContactsPage);
  const setupResendTests = useServerFn(setupResendTestFixture);

  const [query, setQuery] = useState("");
  const [skillFilter, setSkillFilter] = useState(ALL);
  const [categoryFilter, setCategoryFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [kindFilter, setKindFilter] = useState(ALL);
  const [sortBy, setSortBy] = useState<CrmContactSortField>("createdAt");
  const [sortDir, setSortDir] = useState<CrmContactSortDir>("desc");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [skills, setSkills] = useState("");
  const [interests, setInterests] = useState("");
  const [segmentKind, setSegmentKind] = useState<CrmSegmentKind>("new");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailContact, setDetailContact] = useState<CrmContact | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [segmentDialogOpen, setSegmentDialogOpen] = useState(false);

  const ready = useQuery({ queryKey: ["crm-schema-ready"], queryFn: probeCrmSchemaReady });
  const manualReady = useQuery({
    queryKey: ["crm-manual-segments-ready"],
    queryFn: probeCrmManualSegmentsReady,
    enabled: ready.data === true,
  });

  const filterOptionsQuery = useQuery({
    queryKey: ["crm-contacts", id],
    enabled: !!id && ready.data === true,
    queryFn: () => listCrmContacts(id!),
  });

  const listQuery = useMemo(
    () => ({
      query: query.trim() || undefined,
      skills: skillFilter !== ALL ? [skillFilter] : undefined,
      jobCategories: categoryFilter !== ALL ? [categoryFilter] : undefined,
      applicationStatuses: statusFilter !== ALL ? [statusFilter] : undefined,
      segmentKinds: kindFilter !== ALL ? [kindFilter as CrmSegmentKind] : undefined,
      sortBy,
      sortDir,
      page,
      pageSize,
    }),
    [query, skillFilter, categoryFilter, statusFilter, kindFilter, sortBy, sortDir, page],
  );

  const contactsPage = useQuery({
    queryKey: ["crm-contacts-page", id, listQuery],
    enabled: !!id && ready.data === true,
    queryFn: () => fetchPage({ data: listQuery }),
  });

  const filterOptions = useMemo(
    () => collectContactFilterOptions(filterOptionsQuery.data ?? [], id ?? ""),
    [filterOptionsQuery.data, id],
  );

  const contactsById = useMemo(
    () => new Map((filterOptionsQuery.data ?? []).map((c) => [c.id, c])),
    [filterOptionsQuery.data],
  );

  const selectedContactIds = useMemo(() => [...selectedIds], [selectedIds]);

  const activeListFilter = useMemo(
    () => ({
      query: query.trim() || undefined,
      skills: skillFilter !== ALL ? [skillFilter] : undefined,
      jobCategories: categoryFilter !== ALL ? [categoryFilter] : undefined,
      applicationStatuses: statusFilter !== ALL ? [statusFilter] : undefined,
      segmentKinds: kindFilter !== ALL ? [kindFilter as CrmSegmentKind] : undefined,
    }),
    [query, skillFilter, categoryFilter, statusFilter, kindFilter],
  );

  const create = useMutation({
    mutationFn: async () => {
      const result = await createCrmContact({
        recruiterId: id!,
        email,
        fullName,
        skills: skills.split(",").map((s) => s.trim()).filter(Boolean),
        jobInterests: interests.split(",").map((s) => s.trim()).filter(Boolean),
        segmentKind,
      });
      try {
        await syncHubSpot({
          data: {
            contactId: result.contact.id,
            email: result.contact.email,
            fullName: result.contact.fullName,
            segmentKind: result.contact.segmentKind,
          },
        });
      } catch {
        /* soft */
      }
      return result;
    },
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ["crm-contacts", id] });
      void qc.invalidateQueries({ queryKey: ["crm-contacts-page", id] });
      void qc.invalidateQueries({ queryKey: ["crm-dashboard", id] });
      if (result.duplicate) toast.message("Contact already exists for this email");
      else toast.success("Contact saved");
      setEmail("");
      setFullName("");
      setSkills("");
      setInterests("");
    },
    onError: (e: Error) => toast.error(e.message || "Could not save contact"),
  });

  const resendFixture = useMutation({
    mutationFn: () => setupResendTests(),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["crm-contacts", id] });
      void qc.invalidateQueries({ queryKey: ["crm-contacts-page", id] });
      void qc.invalidateQueries({ queryKey: ["crm-segments", id] });
      void qc.invalidateQueries({ queryKey: ["crm-dashboard", id] });
      toast.success(
        `Resend test contacts ready (${r.contactsCreated} new). Segment: ${r.segment.name}`,
      );
      void navigate({ to: "/recruiter/crm/segments/$segmentId", params: { segmentId: r.segment.id } });
    },
    onError: (e: Error) => toast.error(e.message || "Could not set up Resend test fixture"),
  });

  const importApps = useMutation({
    mutationFn: () => importApplicants(),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["crm-contacts", id] });
      void qc.invalidateQueries({ queryKey: ["crm-contacts-page", id] });
      void qc.invalidateQueries({ queryKey: ["crm-dashboard", id] });
      if (!r.ok) {
        toast.error(r.error || "Import failed");
        return;
      }
      const updated = "updated" in r && typeof r.updated === "number" ? r.updated : 0;
      toast.success(`Imported ${r.imported}, updated ${updated}, skipped ${r.skipped}`);
    },
    onError: (e: Error) => toast.error(e.message || "Import failed"),
  });

  const pageContacts = contactsPage.data?.contacts ?? [];
  const total = contactsPage.data?.total ?? 0;
  const totalPages = contactsPage.data?.totalPages ?? 1;

  const pageAllSelected =
    pageContacts.length > 0 && pageContacts.every((c) => selectedIds.has(c.id));
  const pageSomeSelected = pageContacts.some((c) => selectedIds.has(c.id)) && !pageAllSelected;

  function toggleSort(field: CrmContactSortField) {
    if (sortBy === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(field);
      setSortDir(field === "name" || field === "email" ? "asc" : "desc");
    }
    setPage(1);
  }

  function toggleOne(contactId: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(contactId);
      else next.delete(contactId);
      return next;
    });
  }

  function togglePage(checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const c of pageContacts) {
        if (checked) next.add(c.id);
        else next.delete(c.id);
      }
      return next;
    });
  }

  function selectAllMatching() {
    const matching = filterContactsForRecruiter(filterOptionsQuery.data ?? [], id ?? "", activeListFilter);
    setSelectedIds(new Set(matching.map((c) => c.id)));
    toast.message(`Selected ${matching.length} contacts matching current filters`);
  }

  function openDetail(contact: CrmContact) {
    setDetailContact(contact);
    setDetailOpen(true);
  }

  if (ready.isLoading) return <CardSkeleton rows={5} />;
  if (ready.data === false) {
    return (
      <>
        <PageHeader eyebrow="Recruiter" title="Contacts" description="Manage candidate contacts." />
        <EmptyState icon={Users} title="CRM schema not applied" description={CRM_SCHEMA_PENDING_MESSAGE} />
      </>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Recruiter"
        title="Contacts"
        description="Search, filter, and manage candidates. Import or refresh synced fields from your applicants."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={importApps.isPending} onClick={() => importApps.mutate()}>
              Import from applicants
            </Button>
            <Button
              variant="outline"
              disabled={resendFixture.isPending || manualReady.data === false}
              onClick={() => resendFixture.mutate()}
            >
              Set up Resend test contacts
            </Button>
          </div>
        }
      />

      <section className="surface-card space-y-3 p-5 sm:p-6">
        <h2 className="text-sm font-semibold">Resend free testing (no custom domain)</h2>
        <p className="text-sm text-muted-foreground">
          Use official Resend simulator addresses with the sandbox sender{" "}
          <code className="text-xs">onboarding@resend.dev</code>. Messages are not delivered to real inboxes;
          webhooks still fire for delivery, bounce, and complaint simulation.
        </p>
        <ul className="list-inside list-disc text-sm text-muted-foreground">
          {RESEND_TEST_RECIPIENTS.map((r) => (
            <li key={r.email}>
              <span className="font-mono text-xs text-foreground">{r.email}</span> — {r.fullName.replace("Resend test — ", "")}
            </li>
          ))}
        </ul>
      </section>

      <section className="surface-card space-y-4 p-5 sm:p-6">
        <h2 className="text-sm font-semibold">Add contact</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="crm-email">Email</Label>
            <Input id="crm-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="candidate@example.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="crm-name">Full name</Label>
            <Input id="crm-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="crm-skills">Skills (comma-separated)</Label>
            <Input id="crm-skills" value={skills} onChange={(e) => setSkills(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="crm-interests">Job interests (comma-separated)</Label>
            <Input id="crm-interests" value={interests} onChange={(e) => setInterests(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Segment kind</Label>
            <Select value={segmentKind} onValueChange={(v) => setSegmentKind(v as CrmSegmentKind)}>
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
        </div>
        <Button disabled={create.isPending || !email.trim()} onClick={() => create.mutate()}>
          Save contact
        </Button>
      </section>

      <section className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search name, email, skills…"
            aria-label="Search contacts"
            className="xl:col-span-2"
          />
          <Select
            value={skillFilter}
            onValueChange={(v) => {
              setSkillFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Skill" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All skills</SelectItem>
              {filterOptions.skills.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={categoryFilter}
            onValueChange={(v) => {
              setCategoryFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Job category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All categories</SelectItem>
              {filterOptions.jobCategories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Application status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {(Object.keys(STATUS_META) as ApplicationStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_META[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={kindFilter}
            onValueChange={(v) => {
              setKindFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Segment kind" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All kinds</SelectItem>
              {filterOptions.segmentKinds.map((k) => (
                <SelectItem key={k} value={k}>
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted-foreground">
              {selectedIds.size} selected
              {total > pageContacts.length && (
                <>
                  {" · "}
                  <button type="button" className="underline hover:text-foreground" onClick={selectAllMatching}>
                    Select all {total} matching filters
                  </button>
                </>
              )}
            </p>
            <Button
              size="sm"
              disabled={manualReady.data === false}
              title={manualReady.data === false ? CRM_MANUAL_SEGMENTS_PENDING_MESSAGE : undefined}
              onClick={() => setSegmentDialogOpen(true)}
            >
              Create segment from selected contacts
            </Button>
          </div>
        )}

        {contactsPage.isLoading ? (
          <CardSkeleton rows={4} />
        ) : contactsPage.isError ? (
          <ErrorState onRetry={() => void contactsPage.refetch()} />
        ) : pageContacts.length === 0 ? (
          <EmptyState icon={Users} title="No contacts" description="Add a contact or import from your applicants." />
        ) : (
          <>
            <CrmContactsTable
              contacts={pageContacts}
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={toggleSort}
              selectedIds={selectedIds}
              onToggleOne={toggleOne}
              onTogglePage={togglePage}
              pageAllSelected={pageAllSelected}
              pageSomeSelected={pageSomeSelected}
              onRowClick={openDetail}
            />
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>
                Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <span>
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </section>

      <CrmContactDetailSheet
        contact={detailContact}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        recruiterId={id ?? ""}
        onUpdated={(c) => setDetailContact(c)}
      />

      <CreateManualSegmentDialog
        open={segmentDialogOpen}
        onOpenChange={setSegmentDialogOpen}
        selectedContactIds={selectedContactIds}
        contactsById={contactsById}
        onCreated={(segmentId) => {
          void qc.invalidateQueries({ queryKey: ["crm-segments", id] });
          setSelectedIds(new Set());
          void navigate({ to: "/recruiter/crm/segments/$segmentId", params: { segmentId } });
        }}
      />
    </div>
  );
}
