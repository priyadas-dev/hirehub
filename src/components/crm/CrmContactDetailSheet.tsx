import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { STATUS_META, type ApplicationStatus } from "@/components/status/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  contactHasSyncedApplicantData,
  crmContactSource,
} from "@/lib/crm/contacts-list";
import { updateCrmContactManualFields } from "@/lib/crm/contacts.server";
import { importApplicantsToCrm } from "@/lib/crm/import-from-applicants.server";
import type { CrmContact, CrmSegmentKind } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

type Props = {
  contact: CrmContact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recruiterId: string;
  onUpdated?: (contact: CrmContact) => void;
};

export function CrmContactDetailSheet({ contact, open, onOpenChange, recruiterId, onUpdated }: Props) {
  const qc = useQueryClient();
  const save = useServerFn(updateCrmContactManualFields);
  const refreshApplicants = useServerFn(importApplicantsToCrm);

  const [fullName, setFullName] = useState("");
  const [notes, setNotes] = useState("");
  const [interests, setInterests] = useState("");
  const [skills, setSkills] = useState("");
  const [segmentKind, setSegmentKind] = useState<CrmSegmentKind>("new");

  useEffect(() => {
    if (!contact) return;
    setFullName(contact.fullName ?? "");
    setNotes(contact.notes ?? "");
    setInterests(contact.jobInterests.join(", "));
    setSkills(contact.skills.join(", "));
    setSegmentKind(contact.segmentKind);
  }, [contact]);

  const update = useMutation({
    mutationFn: async () => {
      if (!contact) throw new Error("No contact selected");
      const synced = contactHasSyncedApplicantData(contact);
      return save({
        data: {
          contactId: contact.id,
          fullName,
          notes,
          jobInterests: interests.split(",").map((s) => s.trim()).filter(Boolean),
          ...(!synced ? { segmentKind, skills: skills.split(",").map((s) => s.trim()).filter(Boolean) } : {}),
        },
      });
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["crm-contacts-page", recruiterId] });
      void qc.invalidateQueries({ queryKey: ["crm-contacts", recruiterId] });
      void qc.invalidateQueries({ queryKey: ["crm-dashboard", recruiterId] });
      toast.success("Contact updated");
      onUpdated?.(r.contact);
    },
    onError: (e: Error) => toast.error(e.message || "Could not update contact"),
  });

  const refresh = useMutation({
    mutationFn: () => refreshApplicants(),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["crm-contacts-page", recruiterId] });
      void qc.invalidateQueries({ queryKey: ["crm-contacts", recruiterId] });
      void qc.invalidateQueries({ queryKey: ["crm-dashboard", recruiterId] });
      if (!r.ok) {
        toast.error(r.error || "Refresh failed");
        return;
      }
      const updated = "updated" in r && typeof r.updated === "number" ? r.updated : 0;
      toast.success(`Refreshed from applicants (${r.imported} new, ${updated} updated)`);
    },
    onError: (e: Error) => toast.error(e.message || "Refresh failed"),
  });

  if (!contact) return null;

  const synced = contactHasSyncedApplicantData(contact);
  const source = crmContactSource(contact);
  const statusMeta =
    contact.applicationStatus && contact.applicationStatus in STATUS_META
      ? STATUS_META[contact.applicationStatus as ApplicationStatus]
      : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{contact.fullName || contact.email}</SheetTitle>
          <SheetDescription>
            {contact.email} · Source: {source === "import" ? "Applicants import" : "Manual entry"}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Synced from applicants</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={refresh.isPending}
                onClick={() => refresh.mutate()}
              >
                <RefreshCw className={cn("mr-1.5 size-3.5", refresh.isPending && "animate-spin")} />
                Refresh
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Application status, job categories, and profile skills update when you refresh from applicants.
            </p>
            <dl className="grid gap-2 text-sm">
              <div>
                <dt className="text-muted-foreground">Application status</dt>
                <dd className="font-medium">
                  {statusMeta ? (
                    <span className={cn("inline-flex items-center gap-1", statusMeta.text)}>{statusMeta.label}</span>
                  ) : (
                    contact.applicationStatus ?? "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Job categories</dt>
                <dd>{contact.jobCategories.length ? contact.jobCategories.join(", ") : "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Skills (profile)</dt>
                <dd>{contact.skills.length ? contact.skills.join(", ") : "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Segment kind</dt>
                <dd>{contact.segmentKind}</dd>
              </div>
            </dl>
          </section>

          <section className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-semibold">Editable fields</h3>
            <div className="space-y-1.5">
              <Label htmlFor="detail-name">Full name</Label>
              <Input id="detail-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="detail-interests">Job interests</Label>
              <Input
                id="detail-interests"
                value={interests}
                onChange={(e) => setInterests(e.target.value)}
                placeholder="Comma-separated"
              />
            </div>
            {!synced && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="detail-skills">Skills</Label>
                  <Input
                    id="detail-skills"
                    value={skills}
                    onChange={(e) => setSkills(e.target.value)}
                    placeholder="Comma-separated"
                  />
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
              </>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="detail-notes">Notes</Label>
              <Textarea id="detail-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
            </div>
            <Button disabled={update.isPending} onClick={() => update.mutate()}>
              Save changes
            </Button>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
