import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ApplicationStatusOutcomeList,
  SaveJobOutcomeChip,
} from "@/components/assistant/AssistantToolOutcomes";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    children?: React.ReactNode;
  }) => {
    const href =
      typeof to === "string" && params?.applicationId
        ? to.replace("$applicationId", params.applicationId)
        : String(to);
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
}));

describe("AssistantToolOutcomes — save feedback", () => {
  it("shows successful save feedback", () => {
    render(
      <SaveJobOutcomeChip
        outcome={{
          status: "saved",
          savedJobId: "saved-1",
          jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          title: "React Engineer",
        }}
      />,
    );

    expect(screen.getByTestId("save-job-outcome").getAttribute("data-status")).toBe("saved");
    expect(screen.getByText("Saved to bookmarks")).toBeTruthy();
    expect(screen.getByText("React Engineer")).toBeTruthy();
    expect(screen.getByText("View saved")).toBeTruthy();
  });

  it("shows duplicate / already-saved feedback", () => {
    render(
      <SaveJobOutcomeChip
        outcome={{
          status: "already_saved",
          savedJobId: "saved-1",
          jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          title: "React Engineer",
        }}
      />,
    );

    expect(screen.getByTestId("save-job-outcome").getAttribute("data-status")).toBe("already_saved");
    expect(screen.getByText("Already saved")).toBeTruthy();
    expect(screen.getByText("React Engineer")).toBeTruthy();
  });
});

describe("AssistantToolOutcomes — application status", () => {
  it("renders structured status rows with title and badge", () => {
    render(
      <ApplicationStatusOutcomeList
        applications={[
          {
            id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            status: "shortlisted",
            createdAt: "2026-11-01T00:00:00.000Z",
            jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            jobTitle: "Frontend Engineer",
            companyName: "Acme Labs",
            location: "Dhaka",
          },
        ]}
      />,
    );

    expect(screen.getByTestId("application-status-list")).toBeTruthy();
    expect(screen.getByText("Frontend Engineer")).toBeTruthy();
    expect(screen.getByText("Acme Labs")).toBeTruthy();
    expect(screen.getByText("Shortlisted")).toBeTruthy();
    expect(screen.getByText("Track")).toBeTruthy();
  });

  it("shows empty state when there are no applications", () => {
    render(<ApplicationStatusOutcomeList applications={[]} />);
    expect(screen.getByTestId("application-status-empty")).toBeTruthy();
    expect(screen.getByText("No applications found")).toBeTruthy();
    expect(screen.getByText("Browse jobs")).toBeTruthy();
  });

  it("lists more than 10 applications in the UI", () => {
    const applications = Array.from({ length: 12 }, (_, i) => ({
      id: `dddddddd-dddd-4ddd-8ddd-dddddddddd${String(i).padStart(2, "0")}`,
      status: "applied" as const,
      createdAt: "2026-11-01T00:00:00.000Z",
      jobId: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa${String(i).padStart(2, "0")}`,
      jobTitle: `Role ${i + 1}`,
      companyName: "Acme",
      location: null,
    }));

    render(<ApplicationStatusOutcomeList applications={applications} />);
    expect(screen.getByText("Your applications (12)")).toBeTruthy();
    expect(screen.getAllByTestId("application-status-item")).toHaveLength(12);
  });
});
