import * as fs from "node:fs";
import * as path from "node:path";
import { tailJsonl } from "./jsonl.ts";
import { autogoalPaths } from "./workspace.ts";

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

export function buildAutogoalCompactionSummary(cwd: string): string {
  const p = autogoalPaths(cwd);
  const cycleSections = recentCycleFiles(p.cyclesDir).map((file) => {
    const rel = path.relative(cwd, file);
    return `## Recent Cycle: ${rel}\n\n${read(file)}`;
  });
  return [
    "# Autogoal Compaction Summary",
    "",
    "Conversation history was compacted. The `.autogoal/` workspace files below are the source of truth. Continue from persisted state, not from memory.",
    "",
    `## Goal (${path.relative(cwd, p.goal)})\n\n${read(p.goal) || "No goal file."}`,
    `## Mode Guide (${path.relative(cwd, p.modeGuide)})\n\n${read(p.modeGuide) || "No mode guide."}`,
    `## Plan (${path.relative(cwd, p.plan)})\n\n${read(p.plan) || "No plan file."}`,
    `## Backlog (${path.relative(cwd, p.backlog)})\n\n${read(p.backlog) || "No backlog."}`,
    `## Interesting (${path.relative(cwd, p.interesting)})\n\n${read(p.interesting) || "No interesting observations yet."}`,
    ...cycleSections,
    jsonlSection("Recent Evidence", tailJsonl(p.evidence, 20)),
    jsonlSection("Recent Sources", tailJsonl(p.sources, 20)),
    jsonlSection("Recent Metrics", tailJsonl(p.metrics, 20)),
    jsonlSection("Recent Commits", tailJsonl(p.commits, 20)),
    "## Next Step",
    "Read `.autogoal/self-prompts/next-cycle.md` if present, then run the next focused Autogoal subcycle for the active mode and update the required state files.",
  ].filter(Boolean).join("\n\n");
}
