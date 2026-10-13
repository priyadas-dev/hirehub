import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { resolveDisplayUrl } from "@/lib/hirehub-storage";
import { cn } from "@/lib/utils";

type CompanyLogoProps = {
  logoUrl: string | null | undefined;
  companyName?: string | null;
  className?: string;
};

/** Renders a company logo from a Storage path (signed) or legacy https URL. */
export function CompanyLogo({ logoUrl, companyName, className }: CompanyLogoProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBroken(false);
    void (async () => {
      try {
        const url = await resolveDisplayUrl(logoUrl, "logo");
        if (!cancelled) setSrc(url);
      } catch {
        if (!cancelled) setSrc(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [logoUrl]);

  if (!src || broken) {
    return (
      <div
        className={cn(
          "flex size-12 items-center justify-center rounded-xl border bg-signal-soft text-signal",
          className,
        )}
        aria-hidden
      >
        <Building2 className="size-5" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={companyName ? `${companyName} logo` : "Company logo"}
      className={cn("size-12 rounded-xl border object-cover", className)}
      onError={() => setBroken(true)}
    />
  );
}
