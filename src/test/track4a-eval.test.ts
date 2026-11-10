import { describe, expect, it } from "vitest";
import path from "node:path";
import { runAgentScenarios } from "@/lib/ai/agents/agent-scenarios";
import {
  buildTrack4AReport,
  loadAssessment2Snapshot,
  loadLatestA3FrozenSnapshot,
  renderTrack4AMarkdown,
} from "@/lib/ai/eval/track4a-report";

describe("Track 4A evaluation harness", () => {
  it("runs expanded offline agent scenarios with route coverage", async () => {
    const report = await runAgentScenarios();
    expect(report.total).toBeGreaterThanOrEqual(15);
    expect(report.failed).toBe(0);
    expect(report.taskSuccessRate).toBe(1);
    expect(report.byAgent.discovery?.total).toBeGreaterThan(0);
    expect(report.byAgent.application?.total).toBeGreaterThan(0);
    expect(report.byAgent.recruiter?.total).toBeGreaterThan(0);
    expect(report.byAgent.supervisor?.total).toBeGreaterThan(0);
    expect(report.scenarios.some((s) => s.id === "discovery-unsuccessful-empty")).toBe(true);
    expect(report.scenarios.some((s) => s.id === "discovery-guardrail-refuse")).toBe(true);
    expect(report.scenarios.some((s) => s.id === "save-job-idempotent")).toBe(true);
    expect(report.scenarios.some((s) => s.id === "check-status-ownership")).toBe(true);
    expect(report.scenarios.some((s) => s.id === "supervisor-route-recruiter")).toBe(true);
  });

  it("loads Assessment 2 and A3 frozen artifacts without inventing numbers", () => {
    const root = process.cwd();
    const a2 = loadAssessment2Snapshot(root);
    const a3 = loadLatestA3FrozenSnapshot(root);

    // Artifacts may exist in this workspace from prior runs; if present, values must be finite.
    if (a2) {
      expect(a2.sourcePath).toContain("eval-report.json");
      expect(typeof a2.categoryHitRate).toBe("number");
      expect(a2.totalCases).toBeGreaterThanOrEqual(50);
    }
    if (a3) {
      expect(a3.sourcePath).toMatch(/a3-frozen-/);
      expect(a3.evalSetId).toBe("a3_v1");
      expect(typeof a3.hitRate).toBe("number");
    }

    const agents = {
      total: 1,
      passed: 1,
      failed: 0,
      taskSuccessRate: 1,
      byAgent: { discovery: { total: 1, passed: 1, failed: 0, rate: 1 } },
      scenarios: [
        {
          id: "t",
          title: "t",
          agent: "discovery" as const,
          ok: true,
          detail: "ok",
        },
      ],
      generatedAt: new Date().toISOString(),
    };
    const report = buildTrack4AReport({ agents, assessment2: a2, assessment3Rag: a3 });
    const md = renderTrack4AMarkdown(report);
    expect(md).toMatch(/Track 4A/);
    expect(md).toMatch(/Faithfulness/);
    expect(md).toMatch(/Assessment 2/);
    expect(report.comparisonNotes.some((n) => /Do not claim/i.test(n))).toBe(true);
    expect(path.isAbsolute(root)).toBe(true);
  });
});
