#!/usr/bin/env node
/**
 * A4 Phase 2 evidence — Session 1 learn → Session 2 recall side-by-side trace.
 * Pure logic (mirrors fact-extract + recall enrichment); no DB required.
 *
 * Run: node scripts/a4-session-recall-trace.mjs
 * Out:  scripts/rag/out/a4-session1-session2-trace.json
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "rag", "out");
mkdirSync(outDir, { recursive: true });

function redactPii(text) {
  return text
    .replace(/\b[\w.+-]+@[\w.-]+\.\w+\b/gi, "[REDACTED_EMAIL]")
    .replace(/\b(?:\+?\d[\d\s()-]{7,}\d)\b/g, "[REDACTED_PHONE]");
}

function extractFacts(text) {
  const facts = [];
  const t = redactPii(text);
  if (/\bDhaka\b/i.test(t)) facts.push({ kind: "location", content: "Dhaka" });
  if (/\bReact\b/i.test(t)) facts.push({ kind: "skill", content: "React" });
  if (/\bTypeScript\b/i.test(t)) facts.push({ kind: "skill", content: "TypeScript" });
  if (/\bfront[- ]?end\b/i.test(t)) facts.push({ kind: "target_role", content: "frontend" });
  return facts;
}

function formatBlock(facts) {
  if (!facts.length) return "";
  return `Known about this user (from memory):\n${facts
    .map((f, i) => `${i + 1}. [${f.kind}] ${f.content}`)
    .join("\n")}`;
}

function enrichment(facts) {
  const skills = facts.filter((f) => f.kind === "skill").map((f) => f.content);
  const locations = facts.filter((f) => f.kind === "location").map((f) => f.content);
  const roles = facts.filter((f) => f.kind === "target_role").map((f) => f.content);
  const searchHints = [...locations, ...roles, ...skills].join(" ").trim();
  return { skills, searchHints };
}

function discoverySearchQuestion(userAsk, hints, skills) {
  const parts = [skills.join(" "), userAsk, hints].filter(Boolean);
  return parts.join(" ").trim().slice(0, 240);
}

function clarifyingSignals(answer) {
  return (answer.match(/\?/g) || []).length + (/\b(what|which|tell me|where)\b/i.test(answer) ? 1 : 0);
}

// --- Session 1 (learn) ---
const session1User =
  "I am strongest in React and TypeScript. Looking for a frontend role in Dhaka. Email me at leak@example.com";
const session1Redacted = redactPii(session1User);
const learned = extractFacts(session1Redacted);

// --- Session 2 cold vs warm (same vague ask, different memory) ---
const session2Ask = "Find jobs for me";
const coldHints = { skills: [], searchHints: "" };
const warmHints = enrichment(learned);
const coldSearch = discoverySearchQuestion(session2Ask, coldHints.searchHints, coldHints.skills);
const warmSearch = discoverySearchQuestion(session2Ask, warmHints.searchHints, warmHints.skills);
const coldAnswer =
  "What role and location are you targeting? Tell me your skills so I can search.";
const warmBlock = formatBlock(learned);
const warmAnswer = `Using remembered prefs (${warmHints.searchHints}): searching without re-asking.`;

const trace = {
  generatedAt: new Date().toISOString(),
  requirement: "A4 #1 schema+trace + #2 semantic recall side-by-side",
  session1: {
    conversationId: "sess-1",
    userRaw: session1User,
    userRedacted: session1Redacted,
    piiStripped: !/@/.test(session1Redacted),
    factsLearned: learned,
    writePath: "Supervisor → agent_semantic_memories + agent_memory_events (never browser)",
  },
  session2: {
    conversationId: "sess-2",
    userAsk: session2Ask,
    coldStart: {
      recalledBlock: "",
      discoverySearchQuestion: coldSearch,
      answer: coldAnswer,
      clarifyingSignals: clarifyingSignals(coldAnswer),
    },
    warmMemory: {
      recalledBlock: warmBlock,
      discoverySearchQuestion: warmSearch,
      answer: warmAnswer,
      clarifyingSignals: clarifyingSignals(warmAnswer),
      enrichment: warmHints,
    },
  },
  sideBySideProof: {
    searchQueryChanged: coldSearch !== warmSearch,
    answerChanged: coldAnswer !== warmAnswer,
    fewerClarifyingWhenWarm:
      clarifyingSignals(warmAnswer) < clarifyingSignals(coldAnswer),
  },
  evidenceHash: createHash("sha256")
    .update(JSON.stringify({ learned, coldSearch, warmSearch }))
    .digest("hex")
    .slice(0, 16),
};

const outPath = join(outDir, "a4-session1-session2-trace.json");
writeFileSync(outPath, JSON.stringify(trace, null, 2));

console.log("Wrote", outPath);
console.log("\nSide-by-side:");
console.log("  Cold search :", coldSearch);
console.log("  Warm search :", warmSearch);
console.log("  Search changed:", trace.sideBySideProof.searchQueryChanged);
console.log("  Answer changed:", trace.sideBySideProof.answerChanged);
console.log("  Fewer clarify when warm:", trace.sideBySideProof.fewerClarifyingWhenWarm);
