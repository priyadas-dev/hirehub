import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { defaultManualSegmentName } from "@/lib/crm/manual-segments";
import { createManualSegmentFromContacts } from "@/lib/crm/segments.server";
import type { CrmContact } from "@/lib/crm/types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedContactIds: string[];
  contactsById: Map<string, CrmContact>;
  onCreated: (segmentId: string) => void;
};

export function CreateManualSegmentDialog({
  open,
  onOpenChange,
  selectedContactIds,
  contactsById,
  onCreated,
}: Props) {
  const createSegment = useServerFn(createManualSegmentFromContacts);
  const [name, setName] = useState("");

  const selectedContacts = selectedContactIds
    .map((id) => contactsById.get(id))
    .filter((c): c is CrmContact => !!c);

  useEffect(() => {
    if (!open) setName("");
  }, [open]);

  const create = useMutation({
    mutationFn: () =>
      createSegment({
        data: {
          contactIds: selectedContactIds,
          name: name.trim() || undefined,
        },
      }),
    onSuccess: (r) => {
      toast.success(`Manual segment "${r.segment.name}" created (${r.memberCount} contacts)`);
      onCreated(r.segment.id);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message || "Could not create segment"),
  });

  const placeholder = defaultManualSegmentName(selectedContacts);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create segment from selected contacts</DialogTitle>
          <DialogDescription>
            {selectedContactIds.length} contact{selectedContactIds.length === 1 ? "" : "s"} will be added to a new
            manual segment. Leave the name empty to use: {placeholder}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="manual-seg-name">Segment name (optional)</Label>
          <Input
            id="manual-seg-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={placeholder}
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={create.isPending || selectedContactIds.length === 0} onClick={() => create.mutate()}>
            Create manual segment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
