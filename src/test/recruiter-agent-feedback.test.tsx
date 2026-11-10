import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  RecruiterAgentEmpty,
  RecruiterAgentError,
  RecruiterAgentLoading,
  RecruiterAgentSuccess,
} from "@/components/recruiter/RecruiterAgentFeedback";
import { NAV } from "@/components/shell/nav";

describe("RecruiterAgentFeedback", () => {
  it("renders loading, empty, success, and error states", () => {
    const { rerender } = render(<RecruiterAgentLoading label="Running shortlist…" />);
    expect(screen.getByTestId("recruiter-agent-loading")).toHaveTextContent("Running shortlist…");

    rerender(<RecruiterAgentEmpty title="No applicants for this job" description="Apply first." />);
    expect(screen.getByTestId("recruiter-agent-empty")).toHaveTextContent("No applicants for this job");

    rerender(<RecruiterAgentSuccess message="Applicant shortlisted." />);
    expect(screen.getByTestId("recruiter-agent-success")).toHaveTextContent("Applicant shortlisted.");

    const onRetry = vi.fn();
    rerender(
      <RecruiterAgentError message="You can only shortlist applicants for jobs you own." onRetry={onRetry} />,
    );
    expect(screen.getByTestId("recruiter-agent-error")).toHaveTextContent(
      "You can only shortlist applicants for jobs you own.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("Recruiter agent nav", () => {
  it("exposes AI Recruiter Agent under recruiter navigation", () => {
    const item = NAV.recruiter.find((n) => n.to === "/recruiter/agent");
    expect(item?.label).toBe("AI Recruiter Agent");
  });
});
