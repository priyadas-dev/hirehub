import { useEffect, useState } from "react";
import { resolveDisplayUrl } from "@/lib/hirehub-storage";

type ResumeOpenLinkProps = {
  /** Storage path or legacy https URL. */
  storagePath?: string | null;
  legacyUrl?: string | null;
  fileName?: string | null;
  className?: string;
};

/** Opens a resume via short-lived signed URL (Storage) or legacy public URL. */
export function ResumeOpenLink({
  storagePath,
  legacyUrl,
  fileName,
  className = "break-all text-signal underline",
}: ResumeOpenLinkProps) {
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (storagePath) {
          const signed = await resolveDisplayUrl(storagePath, "resume");
          if (!cancelled) setHref(signed);
          return;
        }
        if (legacyUrl) {
          if (!cancelled) setHref(legacyUrl);
          return;
        }
        if (!cancelled) setHref(null);
      } catch {
        if (!cancelled) setHref(legacyUrl ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storagePath, legacyUrl]);

  if (!href) return null;

  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer">
      {fileName || "Open resume"}
    </a>
  );
}
