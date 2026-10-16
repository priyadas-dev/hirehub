import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Briefcase, Loader2, MessageSquareText, Sparkles } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/feedback/States";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { askJobAssistant } from "@/lib/ai/ask-job-assistant";
import { ASSISTANT_SETUP_HINT, type AskJobAssistantResult } from "@/lib/ai/job-assistant";

export const Route = createFileRoute("/_app/seeker/assistant")({
  head: () => ({
    meta: [
      { title: "AI Job Assistant — HireHub" },
      {
        name: "description",
        content: "Ask HireHub about skills, career direction, and approved job opportunities.",
      },
    ],
  }),
  component: SeekerAssistantPage,
});

type ChatTurn = {
  id: string;
  question: string;
  result: AskJobAssistantResult;
};

const STARTERS = [
  "What skills should I build for a frontend role in Dhaka?",
  "How do I prepare for a data analyst interview?",
  "Which approved HireHub jobs match customer support experience?",
] as const;

function SeekerAssistantPage() {
  const ask = useServerFn(askJobAssistant);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(nextQuestion: string) {
    const trimmed = nextQuestion.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setFormError(null);
    try {
      const result = await ask({ data: { question: trimmed } });
      setTurns((prev) => [
        {
          id: `${Date.now()}-${prev.length}`,
          question: trimmed,
          result,
        },
        ...prev,
      ]);
      if (result.ok) setQuestion("");
      else setFormError(result.message);
    } catch (err) {
      const message =
        err instanceof Error && /Unauthorized|auth/i.test(err.message)
          ? "Sign in as a job seeker to use the assistant."
          : "Something went wrong talking to the assistant. Try again.";
      setFormError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Job Seeker"
        title="AI Job Assistant"
        description="Ask about skills, experience, and career direction. Answers are grounded in HireHub’s career corpus and approved live jobs — synthetic docs are never shown as real openings."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/seeker/jobs">
              <Briefcase /> Browse jobs
            </Link>
          </Button>
        }
      />

      <form
        className="surface-card max-w-3xl space-y-4 p-5 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(question);
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="assistant-question">Your question</Label>
          <Textarea
            id="assistant-question"
            rows={4}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. What skills matter for a junior React role?"
            disabled={busy}
            maxLength={1500}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {STARTERS.map((starter) => (
            <Button
              key={starter}
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                setQuestion(starter);
                void submit(starter);
              }}
            >
              <Sparkles className="size-3.5" />
              {starter.length > 42 ? `${starter.slice(0, 42)}…` : starter}
            </Button>
          ))}
        </div>
        {formError && (
          <p className="text-sm text-destructive" role="alert">
            {formError}
          </p>
        )}
        <Button type="submit" variant="signal" disabled={busy || question.trim().length < 3}>
          {busy ? (
            <>
              <Loader2 className="animate-spin" /> Thinking…
            </>
          ) : (
            <>
              <MessageSquareText /> Ask assistant
            </>
          )}
        </Button>
      </form>

      {turns.length === 0 && !busy ? (
        <EmptyState
          icon={MessageSquareText}
          title="Ask your first career question"
          description="Try a starter above, or write your own. If Gemini or corpus RAG is not configured yet, you will see a clear setup message instead of a fake answer."
        />
      ) : (
        <div className="mx-auto max-w-3xl space-y-4">
          {busy && (
            <div className="surface-card animate-fade-in p-5 text-sm text-muted-foreground" aria-busy="true">
              Looking up grounded context and drafting an answer…
            </div>
          )}
          {turns.map((turn) => (
            <article key={turn.id} className="surface-card space-y-3 p-5 sm:p-6">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-signal">You asked</p>
              <p className="text-sm font-medium text-foreground">{turn.question}</p>
              <AssistantResultBlock result={turn.result} />
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function AssistantResultBlock({ result }: { result: AskJobAssistantResult }) {
  if (!result.ok) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4" role="alert">
        <p className="text-sm font-semibold text-destructive">
          {result.code === "gemini_unavailable" ? "Assistant unavailable" : "Could not answer"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{result.message}</p>
        {(result.setupHint || result.code === "gemini_unavailable") && (
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {result.setupHint ?? ASSISTANT_SETUP_HINT}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Assistant</p>
      <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{result.answer}</div>
      {result.insufficientContext && (
        <p className="text-xs text-muted-foreground">
          Marked as insufficient context — no invented vacancies were added.
        </p>
      )}
      <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        <span className="rounded-full border px-2 py-0.5">
          Corpus RAG: {result.ragAvailable ? "available" : "unavailable"}
        </span>
        <span className="rounded-full border px-2 py-0.5">
          Live jobs: {result.liveJobsAvailable ? "checked" : "unavailable"}
        </span>
      </div>
      {result.liveCitations.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-foreground">Real approved HireHub jobs</p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {result.liveCitations.map((job) => (
              <li key={job.id}>
                <Link className="text-signal underline-offset-2 hover:underline" to="/seeker/jobs/$jobId" params={{ jobId: job.id }}>
                  {job.title}
                </Link>
                {job.location ? ` · ${job.location}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.corpusCitations.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-foreground">Synthetic career corpus (not real openings)</p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {result.corpusCitations.map((c) => (
              <li key={`${c.corpus_key}-${c.title}`}>
                {c.title ?? "Untitled"} {c.category ? `(${c.category})` : ""} — practice context only
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
