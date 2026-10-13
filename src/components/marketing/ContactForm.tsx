import { useId, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  buildContactGmailDraft,
  buildContactMailtoDraft,
  contactMessageSchema,
  type ContactMessageInput,
} from "@/lib/contact";
import { submitContactMessage } from "@/lib/submit-contact";

type FormValues = {
  fullName: string;
  email: string;
  subject: string;
  message: string;
  companyWebsite: string;
};

const EMPTY: FormValues = {
  fullName: "",
  email: "",
  subject: "",
  message: "",
  companyWebsite: "",
};

type DraftLinks = { gmail: string; mailto: string };

export function ContactForm({ className }: { className?: string }) {
  const submit = useServerFn(submitContactMessage);
  const formId = useId();
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof ContactMessageInput, string>>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [draftLinks, setDraftLinks] = useState<DraftLinks | null>(null);

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function openEmailDraft(data: {
    fullName: string;
    email: string;
    subject: string;
    message: string;
  }): DraftLinks {
    const links = {
      gmail: buildContactGmailDraft(data),
      mailto: buildContactMailtoDraft(data),
    };
    window.open(links.gmail, "_blank", "noopener,noreferrer");
    return links;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;

    const parsed = contactMessageSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) as Partial<
          Record<keyof ContactMessageInput, string>
        >,
      );
      setFormError(null);
      setDraftLinks(null);
      setSent(false);
      return;
    }

    setErrors({});
    setFormError(null);
    setDraftLinks(null);
    setBusy(true);
    try {
      const result = await submit({ data: parsed.data });
      if (result.ok && result.delivered) {
        setSent(true);
        setValues(EMPTY);
        return;
      }
      if (!result.ok) {
        if (result.fieldErrors) setErrors(result.fieldErrors);
        if (result.code === "provider_not_configured") {
          // Honest fallback: open a prefilled draft to support (does not claim server delivery).
          const links = openEmailDraft(parsed.data);
          setDraftLinks(links);
          setFormError(null);
        } else {
          setFormError(result.message);
        }
        setSent(false);
      }
    } catch {
      setFormError("We couldn't send your message right now. Please try again in a few minutes.");
      setSent(false);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className={className} role="status" aria-live="polite">
        <div className="flex gap-3 rounded-xl border border-signal/30 bg-signal-soft/50 p-5 text-sm">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-signal" aria-hidden />
          <div className="space-y-2">
            <p className="font-medium text-foreground">Message sent</p>
            <p className="text-muted-foreground">
              Thanks — your enquiry was accepted for delivery. We&apos;ll follow up using the email you provided.
            </p>
            <Button type="button" variant="outline" size="sm" className="bg-card" onClick={() => setSent(false)}>
              Send another message
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (draftLinks) {
    return (
      <div className={className} role="status" aria-live="polite">
        <div className="space-y-4 rounded-xl border border-signal/30 bg-signal-soft/40 p-5 text-sm">
          <div className="flex gap-3">
            <Mail className="mt-0.5 size-5 shrink-0 text-signal" aria-hidden />
            <div className="space-y-2">
              <p className="font-medium text-foreground">Open your email draft to finish</p>
              <p className="text-muted-foreground">
                Automatic email sending is not set up on this server yet. We opened a Gmail draft addressed to
                support with your message. Send it from your inbox to complete.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="signal" size="sm" className="shadow-signal" asChild>
              <a href={draftLinks.gmail} target="_blank" rel="noopener noreferrer">
                Open Gmail draft
              </a>
            </Button>
            <Button variant="outline" size="sm" className="bg-card" asChild>
              <a href={draftLinks.mailto}>Open email app</a>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraftLinks(null);
              }}
            >
              Edit message
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className={className} noValidate aria-busy={busy}>
      <div className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
        <label htmlFor={`${formId}-company`}>Company website</label>
        <input
          id={`${formId}-company`}
          name="companyWebsite"
          tabIndex={-1}
          autoComplete="off"
          value={values.companyWebsite}
          onChange={(e) => update("companyWebsite", e.target.value)}
        />
      </div>

      <div className="space-y-5">
        <Field
          id={`${formId}-fullName`}
          label="Full name"
          autoComplete="name"
          placeholder="Your full name"
          value={values.fullName}
          onChange={(v) => update("fullName", v)}
          error={errors.fullName}
          disabled={busy}
        />
        <Field
          id={`${formId}-email`}
          label="Email address"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={values.email}
          onChange={(v) => update("email", v)}
          error={errors.email}
          disabled={busy}
        />
        <Field
          id={`${formId}-subject`}
          label="Subject"
          placeholder="How can we help?"
          value={values.subject}
          onChange={(v) => update("subject", v)}
          error={errors.subject}
          disabled={busy}
        />
        <div className="space-y-1.5">
          <Label htmlFor={`${formId}-message`}>Message</Label>
          <Textarea
            id={`${formId}-message`}
            name="message"
            rows={5}
            placeholder="Share a few details about your question"
            value={values.message}
            onChange={(e) => update("message", e.target.value)}
            disabled={busy}
            aria-invalid={!!errors.message}
            aria-describedby={errors.message ? `${formId}-message-err` : undefined}
            className="rounded-lg bg-card focus-visible:ring-signal/30"
          />
          {errors.message && (
            <p id={`${formId}-message-err`} className="text-xs text-destructive">
              {errors.message}
            </p>
          )}
        </div>

        {formError && (
          <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        )}

        <Button type="submit" variant="signal" className="w-full shadow-signal sm:w-auto" disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="animate-spin" aria-hidden />
              Sending…
            </>
          ) : (
            "Submit message"
          )}
        </Button>
        <p className="text-xs text-muted-foreground">
          If automatic delivery is unavailable, we open a Gmail draft to support so you can send it yourself.
        </p>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  error,
  value,
  onChange,
  disabled,
  ...props
}: {
  id: string;
  label: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "id">) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
        className="h-11 rounded-lg bg-card focus-visible:ring-signal/30"
        {...props}
      />
      {error && (
        <p id={`${id}-err`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
