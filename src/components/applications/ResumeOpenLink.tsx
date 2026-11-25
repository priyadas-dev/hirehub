import { useEffect, useState } from "react";
import { resolveDisplayUrl } from "@/lib/hirehub-storage";
import { RECRUITER_RESUME_ACCESS_DENIED_MESSAGE } from "@/lib/ai/agents/recruiter-applicant-access";

type ResumeOpenLinkProps = {
  /** Storage path or legacy https URL. */
  storagePath?: string | null;
  legacyUrl?: string | null;
  fileName?: string | null;
  className?: string;
};

type LinkState =
  | { status: "loading" }
  | { status: "ready"; href: string }
  | { status: "denied" }
  | { status: "empty" };

/**
 * Opens a resume via short-lived signed URL (Storage) or legacy public URL.
 * When a Storage path is present and signing fails (RLS deny / 403), show
 * Access denied — do not silently fall back to a legacy URL for that path.
 */
export function ResumeOpenLink({
  storagePath,
  legacyUrl,
  fileName,
  className = "break-all text-signal underline",
}: ResumeOpenLinkProps) {
  const [state, setState] = useState<LinkState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (storagePath) {
          const signed = await resolveDisplayUrl(storagePath, "resume");
          if (cancelled) return;
          if (signed) setState({ status: "ready", href: signed });
          else setState({ status: "denied" });
          return;
        }
        if (legacyUrl) {
          if (!cancelled) setState({ status: "ready", href: legacyUrl });
          return;
        }
        if (!cancelled) setState({ status: "empty" });
      } catch {
        if (cancelled) return;
        // Storage path was requested → treat failure as deny (other recruiter / anon).
        if (storagePath) setState({ status: "denied" });
        else if (legacyUrl) setState({ status: "ready", href: legacyUrl });
        else setState({ status: "empty" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storagePath, legacyUrl]);

  if (state.status === "loading" || state.status === "empty") return null;

  if (state.status === "denied") {
    return (
      <span className={className.replace("underline", "").trim()} role="status" title={RECRUITER_RESUME_ACCESS_DENIED_MESSAGE}>
        Access denied
      </span>
    );
  }

  return (
    <a className={className} href={state.href} target="_blank" rel="noopener noreferrer">
      {fileName || "Open resume"}
    </a>
  );
}
