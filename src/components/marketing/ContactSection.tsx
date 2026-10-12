import { Link } from "@tanstack/react-router";
import { Mail, Phone } from "lucide-react";
import { ContactForm } from "@/components/marketing/ContactForm";
import { SUPPORT_EMAIL, SUPPORT_PHONE_DISPLAY } from "@/lib/contact";

export function ContactSection() {
  return (
    <section id="contact" aria-labelledby="contact-heading" className="border-t border-border/60">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 id="contact-heading" className="font-display text-3xl tracking-tight sm:text-4xl">
            Get in Touch
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
            Have a question about finding a job, posting a vacancy, managing an application, or using HireHub?
            Send us a message, and we&apos;ll make sure your enquiry reaches the right place.
          </p>
        </div>

        <div className="mt-10 grid gap-8 sm:mt-12 lg:grid-cols-2 lg:gap-12">
          <aside className="surface-card h-fit space-y-6 p-6 sm:p-8">
            <h3 className="text-lg font-semibold tracking-tight">Contact information</h3>
            <ul className="space-y-5 text-sm">
              <li className="flex gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-signal-soft text-signal ring-1 ring-signal/15">
                  <Mail className="size-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</p>
                  <a
                    href={`mailto:${SUPPORT_EMAIL}`}
                    className="mt-1 block break-all font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {SUPPORT_EMAIL}
                  </a>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface text-muted-foreground ring-1 ring-border">
                  <Phone className="size-4" aria-hidden />
                </span>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Phone</p>
                  {/* Plain text until country code / tel: format is confirmed */}
                  <p className="mt-1 font-medium text-foreground">{SUPPORT_PHONE_DISPLAY}</p>
                </div>
              </li>
            </ul>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Prefer a dedicated page?{" "}
              <Link to="/support" className="font-medium text-signal underline-offset-4 hover:underline">
                Open Contact Support
              </Link>
              .
            </p>
          </aside>

          <div className="surface-card relative p-6 sm:p-8">
            <h3 className="text-lg font-semibold tracking-tight">Send a message</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              All fields are required. We use your email only to reply to this enquiry.
            </p>
            <ContactForm className="relative mt-6" />
          </div>
        </div>
      </div>
    </section>
  );
}
