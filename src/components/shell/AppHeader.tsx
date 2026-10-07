import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bell, LogOut, Menu, Search, Settings, User } from "lucide-react";
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
import { ROLE_LABEL, useAuth, type SessionUser } from "@/lib/auth";
import { SidebarNav } from "./AppSidebar";

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function UserMenu({ user }: { user: SessionUser }) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2.5 rounded-full p-0.5 pr-1 transition-colors hover:bg-accent sm:pr-3" aria-label="Open profile menu">
          <Avatar className="size-8">
            <AvatarFallback className="bg-signal-soft text-xs font-semibold text-signal">{initials(user.name)}</AvatarFallback>
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
        <DropdownMenuItem onSelect={() => toast("Profile is coming soon")}><User /> Profile</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => toast("Settings are coming soon")}><Settings /> Settings</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            signOut();
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

export function AppHeader({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-md sm:px-6">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
            <Menu />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 bg-sidebar p-5">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Logo to="/dashboard" className="mb-8 px-2" />
          <SidebarNav role={user.role} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <label className="relative hidden max-w-md flex-1 md:block">
        <span className="sr-only">Search</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          placeholder="Search jobs, companies, people…"
          className="h-10 w-full rounded-lg border bg-card pl-9 pr-14 text-sm shadow-xs outline-none transition placeholder:text-muted-foreground focus:border-signal focus:ring-4 focus:ring-signal/10"
        />
        <kbd className="absolute right-3 top-1/2 -translate-y-1/2 rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">⌘K</kbd>
      </label>

      <div className="ml-auto flex items-center gap-1.5">
        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative" onClick={() => toast("You're all caught up", { description: "New notifications will show up here." })}>
          <Bell />
          <span className="absolute right-2 top-2 size-2 rounded-full bg-signal ring-2 ring-background" />
        </Button>
        <UserMenu user={user} />
      </div>
    </header>
  );
}
