import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { Brain, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { forgetMyAgentMemory } from "@/lib/ai/memory/forget-agent-memory";

/** A4 — clear durable agent memory without deleting the account. */
export function ForgetAgentMemorySection() {
  const forgetMemory = useServerFn(forgetMyAgentMemory);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      const result = await forgetMemory();
      if (!result.ok) throw new Error(result.message);
      return result;
    },
    onSuccess: (result) => {
      // Close dialog first; toast after Radix focus restore so Sonner stays visible.
      setConfirmOpen(false);
      window.setTimeout(() => {
        toast.success("Agent memory cleared", {
          id: "a4-forget-agent-memory",
          duration: 6000,
          description: `Removed ${result.deleted.sessions} sessions, ${result.deleted.events} events, ${result.deleted.semantic} facts.`,
        });
      }, 50);
    },
    onError: (e: Error) => {
      toast.error("Could not clear memory", {
        id: "a4-forget-agent-memory-error",
        duration: 6000,
        description: e.message,
      });
    },
  });

  return (
    <section className="surface-card max-w-xl space-y-4 p-5 sm:p-6">
      <div className="flex gap-3">
        <Brain className="mt-0.5 size-5 text-signal" aria-hidden />
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Forget my agent memory</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Deletes HireHub assistant memory for your account (sessions, events, learned prefs).
            Profile, applications, and jobs are not deleted.
          </p>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="outline" disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="animate-spin" /> : <Brain />}
            Forget agent memory
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear assistant memory?</AlertDialogTitle>
            <AlertDialogDescription>
              The assistant will forget target roles, locations, skills, and past chat context.
              Your account stays active.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel>
            {/* Prefer Button over AlertDialogAction — avoids auto-close racing the mutation toast. */}
            <Button
              type="button"
              variant="default"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? "Clearing…" : "Yes, forget me"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
