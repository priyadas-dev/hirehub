import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Stable Unsplash asset — collaborative career / hiring context. */
const ABOUT_IMAGE =
  "https://images.unsplash.com/photo-1521737711867-e3b97375f902?auto=format&fit=crop&w=1200&q=80";

export function AboutSection() {
  return (
    <section id="about" aria-labelledby="about-heading" className="border-t border-signal/15 bg-signal-soft/20">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-2 lg:gap-14">
        <div className="order-2 lg:order-1">
          <div className="overflow-hidden rounded-2xl border border-signal/15 bg-card shadow-card">
            <img
              src={ABOUT_IMAGE}
              alt="Professionals collaborating around a laptop during a hiring discussion"
              width={1200}
              height={800}
              loading="lazy"
              decoding="async"
              className="aspect-[4/3] w-full object-cover"
            />
          </div>
        </div>

        <div className="order-1 lg:order-2">
          <h2 id="about-heading" className="font-display text-3xl tracking-tight sm:text-4xl">
            About HireHub
          </h2>
          <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            HireHub makes the hiring journey simpler by bringing job seekers and recruiters together in one organized
            platform. Job seekers can explore opportunities and track applications, while recruiters can manage job
            openings and move suitable candidates through the hiring process. Our goal is to make finding opportunities
            and managing recruitment clearer and more accessible.
          </p>
          <p className="mt-4 text-sm font-medium text-foreground">
            One platform. Better connections. Clearer hiring journeys.
          </p>
          <div className="mt-8">
            <Button variant="signal" className="shadow-signal" asChild>
              <Link to="/auth" search={{ mode: "signup" }}>
                Get started <ArrowRight />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
