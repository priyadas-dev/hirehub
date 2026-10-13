import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RoleWelcome } from "@/components/dashboard/RoleWelcome";
import {
  clearRoleWelcomeSession,
  ROLE_WELCOME_EXIT_MS,
  ROLE_WELCOME_FAREWELL_MS,
  ROLE_WELCOME_HOLD_MS,
  ROLE_WELCOME_REDUCED_HOLD_MS,
  shouldShowRoleWelcome,
} from "@/lib/role-welcome";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("RoleWelcome auto-dismiss", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("shows the profile first name and auto-dismisses without clicking close", () => {
    render(<RoleWelcome userId="rec-1" fullName="Miyra Das" role="recruiter" />);

    expect(screen.getByText("Welcome, Miyra!")).toBeInTheDocument();
    expect(screen.getByTestId("role-welcome")).toHaveAttribute("data-phase", "enter");

    act(() => {
      vi.advanceTimersByTime(560);
    });
    expect(screen.getByTestId("role-welcome")).toHaveAttribute("data-phase", "idle");

    act(() => {
      vi.advanceTimersByTime(ROLE_WELCOME_HOLD_MS - 560);
    });
    expect(screen.getByTestId("role-welcome")).toHaveAttribute("data-phase", "farewell");

    act(() => {
      vi.advanceTimersByTime(ROLE_WELCOME_FAREWELL_MS + ROLE_WELCOME_EXIT_MS + 50);
    });
    expect(screen.queryByTestId("role-welcome")).not.toBeInTheDocument();
  });

  it("dismisses immediately when close is clicked", () => {
    render(<RoleWelcome userId="seek-1" fullName="Priya Das" role="seeker" />);
    expect(screen.getByText("Welcome, Priya!")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /dismiss welcome/i }));

    act(() => {
      vi.advanceTimersByTime(ROLE_WELCOME_EXIT_MS + 20);
    });
    expect(screen.queryByTestId("role-welcome")).not.toBeInTheDocument();
  });

  it("still auto-dismisses under reduced motion (shorter timeline, no stuck card)", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));

    render(<RoleWelcome userId="seek-2" fullName="Anik Dey" role="seeker" />);
    expect(screen.getByTestId("role-welcome")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(ROLE_WELCOME_REDUCED_HOLD_MS + 200);
    });
    expect(screen.queryByTestId("role-welcome")).not.toBeInTheDocument();
  });

  it("survives React Strict Mode effect re-run without canceling auto-dismiss", () => {
    render(
      <StrictMode>
        <RoleWelcome userId="rec-2" fullName="Koushik Roy" role="recruiter" />
      </StrictMode>,
    );
    expect(screen.getByText("Welcome, Koushik!")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(ROLE_WELCOME_HOLD_MS + ROLE_WELCOME_FAREWELL_MS + ROLE_WELCOME_EXIT_MS + 50);
    });
    expect(screen.queryByTestId("role-welcome")).not.toBeInTheDocument();
  });

  it("allows welcome again after sign-out clears the session flag", () => {
    render(<RoleWelcome userId="rec-3" fullName="Miyra Das" role="recruiter" />);
    expect(shouldShowRoleWelcome("rec-3")).toBe(false);

    clearRoleWelcomeSession();
    expect(shouldShowRoleWelcome("rec-3")).toBe(true);

    cleanup();
    render(<RoleWelcome userId="rec-3" fullName="Miyra Das" role="recruiter" />);
    expect(screen.getByText("Welcome, Miyra!")).toBeInTheDocument();
  });
});
