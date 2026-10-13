import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Mail, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/Logo";
import { ContactForm } from "@/components/marketing/ContactForm";
import { ContactEmailLinks, ContactPhoneLink } from "@/components/marketing/ContactDetails";
import { HomeNavLink } from "@/components/marketing/HomeNavLink";

export const Route = createFileRoute("/support")({
  head: () => ({
    meta: [
      { title: "Support — HireHub" },
      { name: "description", content: "Get help using HireHub." },
    ],
  }),
  component: SupportPage,
});

function SupportPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <Button variant="ghost" size="sm" asChild>
            <HomeNavLink aria-label="Go to homepage">
              <ArrowLeft /> Home
            </HomeNavLink>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="font-display text-3xl tracking-tight sm:text-4xl">Contact support</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Have a question about finding a job, posting a vacancy, or using HireHub? Send a message below. If
          automatic delivery is unavailable, we open a Gmail draft so you can send it from your inbox.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <div className="surface-card flex gap-3 p-4">
            <Mail className="mt-0.5 size-4 shrink-0 text-signal" aria-hidden />
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">Email</p>
              <ContactEmailLinks compact className="mt-0.5" />
            </div>
          </div>
          <div className="surface-card flex gap-3 p-4">
            <Phone className="mt-0.5 size-4 shrink-0 text-signal" aria-hidden />
            <div>
              <p className="text-xs font-medium text-muted-foreground">Phone</p>
              <ContactPhoneLink compact />
            </div>
          </div>
        </div>

        <div className="surface-card relative mt-8 p-6 sm:p-8">
          <ContactForm />
        </div>
      </main>
    </div>
  );
}
