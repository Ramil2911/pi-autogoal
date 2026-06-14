import * as fs from "node:fs";
import * as path from "node:path";
import { tailJsonl } from "./jsonl.ts";
import { autogoalPaths, readState, runAutogoalPaths } from "./workspace.ts";

function read(file: string): string {
  try {
    return fs.existsSync(file) ? fs.readFileSync(file, "utf-8").trim() : "";
  } catch {
    return "";
  }
}

function recentCycleFiles(dir: string, limit = 5): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .slice(-limit)
    .map((name) => path.join(dir, name));
}

function jsonlSection(title: string, rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return `## ${title}\n\nNo entries.`;
  return [`## ${title}`, "", ...rows.map((row) => `- ${JSON.stringify(row)}`)].join("\n");
}

function tailCombinedJsonl(primary: string, legacy: string, limit = 20): Record<string, unknown>[] {
  const rows = [...tailJsonl(legacy, limit), ...tailJsonl(primary, limit)];
  return rows.slice(-limit);
}

function combinedMarkdown(primary: string, legacy: string): string {
  const primaryText = read(primary);
  const legacyText = read(legacy);
  return [primaryText, legacyText && `## Legacy\n\n${legacyText}`].filter(Boolean).join("\n\n");
}

export function buildAutogoalCompactionSummary(cwd: string): string {
  const p = autogoalPaths(cwd);
  const state = readState(cwd);
  const run = state.runId ? runAutogoalPaths(cwd, state.runId) : null;
  const cycleSections = recentCycleFiles(p.cyclesDir).map((file) => {
    const rel = path.relative(cwd, file);
    return `## Recent Cycle: ${rel}\n\n${read(file)}`;
  });
  return [
    "# Autogoal Compaction Summary",
    "",
    "Conversation history was compacted. The `.autogoal/` workspace files below are the source of truth. Continue from persisted state, not from memory.",
    "",
    state.runId ? `## Active Run\n\nRun id: \`${state.runId}\`\nRun directory: \`${path.relative(cwd, run!.root)}\`` : "## Active Run\n\nNo active run id.",
    `## Goal (${path.relative(cwd, p.goal)})\n\n${read(p.goal) || "No goal file."}`,
    `## Mode Guide (${path.relative(cwd, p.modeGuide)})\n\n${read(p.modeGuide) || "No mode guide."}`,
    `## Plan (${path.relative(cwd, p.plan)})\n\n${read(p.plan) || "No plan file."}`,
    `## Backlog (${path.relative(cwd, p.backlog)})\n\n${read(p.backlog) || "No backlog."}`,
    `## Leads (${path.relative(cwd, p.leads)})\n\n${combinedMarkdown(p.leads, p.legacyInteresting) || "No leads yet."}`,
    ...cycleSections,
    jsonlSection("Recent Findings", tailCombinedJsonl(p.findings, p.legacyEvidence, 20)),
    jsonlSection("Recent Sources", tailJsonl(p.sources, 20)),
    jsonlSection("Recent Metrics", tailJsonl(p.metrics, 20)),
    "## Next Step",
    "Read `.autogoal/self-prompts/next-cycle.md` if present, then run the next focused Autogoal subcycle for the active mode and update the required state files.",
  ].filter(Boolean).join("\n\n");
}
