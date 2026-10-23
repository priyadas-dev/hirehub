import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AssistantMarkdown } from "@/components/assistant/AssistantMarkdown";

describe("AssistantMarkdown", () => {
  it("renders bold markers instead of raw ** text", () => {
    render(<AssistantMarkdown text="Try **Set Job Alerts** and keep learning." />);
    expect(screen.getByText("Set Job Alerts").tagName).toBe("STRONG");
    expect(screen.queryByText(/\*\*/)).toBeNull();
  });

  it("renders simple bullet lists", () => {
    render(<AssistantMarkdown text={"Tips:\n\n- Learn React\n- Practice TypeScript"} />);
    expect(screen.getByText("Learn React")).toBeTruthy();
    expect(screen.getByText("Practice TypeScript")).toBeTruthy();
  });
});
