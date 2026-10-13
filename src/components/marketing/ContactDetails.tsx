import {
  SUPPORT_EMAIL,
  SUPPORT_GMAIL_COMPOSE_HREF,
  SUPPORT_MAILTO_HREF,
  SUPPORT_PHONE_DISPLAY,
  SUPPORT_TEL_HREF,
} from "@/lib/contact";

const linkClass =
  "font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type ContactEmailLinksProps = {
  className?: string;
  /** Compact layout for the support page cards. */
  compact?: boolean;
};

/** Gmail compose (new tab) + mailto fallback — To is always the HireHub support address. */
export function ContactEmailLinks({ className, compact }: ContactEmailLinksProps) {
  return (
    <div className={className}>
      <a
        href={SUPPORT_GMAIL_COMPOSE_HREF}
        target="_blank"
        rel="noopener noreferrer"
        className={`${linkClass} break-all ${compact ? "text-sm" : "mt-1 block"}`}
        aria-label={`Compose email to ${SUPPORT_EMAIL} in Gmail`}
      >
        {SUPPORT_EMAIL}
      </a>
      <p className={`text-xs text-muted-foreground ${compact ? "mt-1" : "mt-1.5"}`}>
        Opens Gmail compose.{" "}
        <a href={SUPPORT_MAILTO_HREF} className="text-signal underline-offset-4 hover:underline">
          Or use your email app
        </a>
        .
      </p>
    </div>
  );
}

export function ContactPhoneLink({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <a
      href={SUPPORT_TEL_HREF}
      className={`${linkClass} ${compact ? "mt-0.5 block text-sm" : "mt-1 block"} ${className ?? ""}`}
      aria-label={`Call ${SUPPORT_PHONE_DISPLAY}`}
    >
      {SUPPORT_PHONE_DISPLAY}
    </a>
  );
}
