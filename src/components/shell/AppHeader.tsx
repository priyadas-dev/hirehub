import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { LogOut, Menu, Search, Settings, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Logo } from "@/components/brand/Logo";
import { ROLE_HOME, ROLE_LABEL, useAuth, type SessionUser } from "@/lib/auth";
import { headerSearchPlaceholder, headerSearchTarget } from "@/lib/header-search";
import { APP_CONTENT_SHELL } from "@/lib/shell-layout";
import { NotificationsButton } from "./NotificationsPanel";
import { SidebarNav } from "./AppSidebar";

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function profilePath(role: SessionUser["role"]) {
  if (role === "seeker") return "/seeker/profile" as const;
  if (role === "recruiter") return "/recruiter/company" as const;
  return "/admin/profile" as const;
}

function UserMenu({ user }: { user: SessionUser }) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2.5 rounded-full p-0.5 pr-1 transition-colors hover:bg-accent sm:pr-3"
          aria-label="Open profile menu"
        >
          <Avatar className="size-8">
            <AvatarFallback className="bg-signal-soft text-xs font-semibold text-signal">
              {initials(user.name)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden text-left sm:block">
            <span className="block text-sm font-medium leading-tight">{user.name}</span>
            <span className="block text-xs text-muted-foreground">{ROLE_LABEL[user.role]}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 rounded-xl">
        <DropdownMenuLabel className="font-normal">
          <p className="text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void navigate({ to: profilePath(user.role) })}>
          <User /> Profile
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void navigate({ to: "/settings" })}>
          <Settings /> Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await signOut();
            toast.success("Signed out");
            navigate({ to: "/auth", replace: true });
          }}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HeaderSearch({ user }: { user: SessionUser }) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const searchQ = useRouterState({
    select: (s) => {
      const search = s.location.search as Record<string, unknown>;
      const q = search["q"];
      return typeof q === "string" ? q : "";
    },
  });
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onJobsSearchPage =
      /^\/seeker\/jobs\/?$/.test(pathname) ||
      /^\/recruiter\/jobs\/?$/.test(pathname) ||
      /^\/admin\/jobs\/?$/.test(pathname);
    if (!onJobsSearchPage) return;
    setQuery((current) => (current === searchQ || current.trim() === searchQ ? current : searchQ));
  }, [pathname, searchQ]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const runSearch = (event?: FormEvent) => {
    event?.preventDefault();
    const target = headerSearchTarget(user.role, query);
    if (target.to === "/recruiter/jobs") {
      void navigate({
        to: "/recruiter/jobs",
        search: (prev) => {
          const status = prev.status;
          const jobStatus =
            status === "pending" || status === "approved" || status === "closed" ? status : undefined;
          return {
            ...(jobStatus !== undefined ? { status: jobStatus } : {}),
            ...("q" in target.search && target.search.q !== undefined ? { q: target.search.q } : {}),
          };
        },
      });
      return;
    }
    void navigate({ to: target.to, search: target.search });
  };

  return (
    <form onSubmit={runSearch} className="relative min-w-0 max-w-md flex-1" role="search">
      <label htmlFor="header-job-search" className="sr-only">
        Search
      </label>
      <button
        type="submit"
        aria-label="Search"
        className="absolute left-0 top-0 flex h-10 w-10 items-center justify-center rounded-l-lg text-muted-foreground transition-colors hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40"
      >
        <Search className="size-4" aria-hidden />
      </button>
      <input
        id="header-job-search"
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={headerSearchPlaceholder(user.role)}
        className="h-10 w-full rounded-lg border border-signal/15 bg-card pl-10 pr-16 text-sm shadow-xs outline-none transition placeholder:text-muted-foreground focus:border-signal focus:ring-4 focus:ring-signal/15"
        autoComplete="off"
        enterKeyHint="search"
      />
      <button
        type="submit"
        aria-label="Search"
        title="Search"
        className="absolute right-1.5 top-1/2 hidden h-7 -translate-y-1/2 items-center rounded border border-signal/20 bg-signal-soft px-1.5 font-mono text-[10px] text-signal transition-colors hover:border-signal/40 hover:bg-signal/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 sm:inline-flex"
      >
        ⌘K
      </button>
    </form>
  );
}

export function AppHeader({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 border-b border-signal/15 bg-background/85 backdrop-blur-md">
      {/* Same max-width + horizontal padding as main so search/profile align with welcome cards. */}
      <div className={`${APP_CONTENT_SHELL} flex h-16 items-center gap-3`}>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 border-signal/15 bg-sidebar p-5">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <div className="absolute inset-y-0 left-0 w-1 bg-signal" aria-hidden />
            <Logo to={ROLE_HOME[user.role]} className="relative mb-8 px-2" />
            <div className="relative">
              <SidebarNav role={user.role} onNavigate={() => setOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>

        <HeaderSearch user={user} />

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <NotificationsButton userId={user.id} />
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}
