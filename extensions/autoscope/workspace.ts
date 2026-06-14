import * as fs from "node:fs";
import * as path from "node:path";

export const AUTOSCOPE_DIR = ".autoscope";

export type AutoscopeStatus = "idle" | "running" | "paused" | "stopped";

export interface AutoscopeConfig {
  autonomy: "full" | "supervised";
  maxAutoTurns: number;
  maxCycles: number;
  maxNoProgressCycles: number;
  reviewEveryCycles: number;
  oracleEveryCycles: number;
  requireHumanOnGoalShift: boolean;
  settleMs: number;
  stopIfRequiresHuman: boolean;
  defaultCycleBudget: string;
}

export interface AutoscopeState {
  status: AutoscopeStatus;
  auto: boolean;
  title: string | null;
  cycleIndex: number;
  autoTurnsSent: number;
  requiresHuman: boolean;
  lastPromptAt: string | null;
  updatedAt: string;
}

export interface AutoscopePaths {
  root: string;
  config: string;
  state: string;
  goal: string;
  plan: string;
  backlog: string;
  questions: string;
  interesting: string;
  sources: string;
  evidence: string;
  events: string;
  cyclesDir: string;
  reportsDir: string;
  selfPromptsDir: string;
  nextCycle: string;
  artifactsDir: string;
}

export const DEFAULT_CONFIG: AutoscopeConfig = {
  autonomy: "full",
  maxAutoTurns: 50,
  maxCycles: 50,
  maxNoProgressCycles: 5,
  reviewEveryCycles: 3,
  oracleEveryCycles: 5,
  requireHumanOnGoalShift: false,
  settleMs: 800,
  stopIfRequiresHuman: true,
  defaultCycleBudget: "one focused subcycle unless evidence requires more",
};

export function defaultState(title: string | null = null): AutoscopeState {
  return {
    status: "idle",
    auto: false,
    title,
    cycleIndex: 0,
    autoTurnsSent: 0,
    requiresHuman: false,
    lastPromptAt: null,
    updatedAt: new Date().toISOString(),
  };
}

export function autoscopePaths(cwd: string): AutoscopePaths {
  const root = path.join(cwd, AUTOSCOPE_DIR);
  const selfPromptsDir = path.join(root, "self-prompts");
  return {
    root,
    config: path.join(root, "config.json"),
    state: path.join(root, "state.json"),
    goal: path.join(root, "goal.md"),
    plan: path.join(root, "plan.md"),
    backlog: path.join(root, "backlog.md"),
    questions: path.join(root, "questions.md"),
    interesting: path.join(root, "interesting.md"),
    sources: path.join(root, "sources.jsonl"),
    evidence: path.join(root, "evidence.jsonl"),
    events: path.join(root, "events.jsonl"),
    cyclesDir: path.join(root, "cycles"),
    reportsDir: path.join(root, "reports"),
    selfPromptsDir,
    nextCycle: path.join(selfPromptsDir, "next-cycle.md"),
    artifactsDir: path.join(root, "artifacts"),
  };
}

export function workspaceExists(cwd: string): boolean {
  return fs.existsSync(autoscopePaths(cwd).root);
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function writeIfMissing(file: string, content: string): void {
  if (!fs.existsSync(file)) fs.writeFileSync(file, content);
}

function readJsonObject(file: string): Record<string, unknown> | null {
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function readConfig(cwd: string): AutoscopeConfig {
  const raw = readJsonObject(autoscopePaths(cwd).config);
  return {
    autonomy: raw?.autonomy === "supervised" ? "supervised" : DEFAULT_CONFIG.autonomy,
    maxAutoTurns: typeof raw?.maxAutoTurns === "number" ? raw.maxAutoTurns : DEFAULT_CONFIG.maxAutoTurns,
    maxCycles: typeof raw?.maxCycles === "number" ? raw.maxCycles : DEFAULT_CONFIG.maxCycles,
    maxNoProgressCycles: typeof raw?.maxNoProgressCycles === "number" ? raw.maxNoProgressCycles : DEFAULT_CONFIG.maxNoProgressCycles,
    reviewEveryCycles: typeof raw?.reviewEveryCycles === "number" ? raw.reviewEveryCycles : DEFAULT_CONFIG.reviewEveryCycles,
    oracleEveryCycles: typeof raw?.oracleEveryCycles === "number" ? raw.oracleEveryCycles : DEFAULT_CONFIG.oracleEveryCycles,
    requireHumanOnGoalShift: typeof raw?.requireHumanOnGoalShift === "boolean" ? raw.requireHumanOnGoalShift : DEFAULT_CONFIG.requireHumanOnGoalShift,
    settleMs: typeof raw?.settleMs === "number" ? raw.settleMs : DEFAULT_CONFIG.settleMs,
    stopIfRequiresHuman: typeof raw?.stopIfRequiresHuman === "boolean" ? raw.stopIfRequiresHuman : DEFAULT_CONFIG.stopIfRequiresHuman,
    defaultCycleBudget: typeof raw?.defaultCycleBudget === "string" ? raw.defaultCycleBudget : DEFAULT_CONFIG.defaultCycleBudget,
  };
}

export function readState(cwd: string): AutoscopeState {
  const raw = readJsonObject(autoscopePaths(cwd).state);
  const base = defaultState();
  const status = ["idle", "running", "paused", "stopped"].includes(String(raw?.status))
    ? raw!.status as AutoscopeStatus
    : base.status;
  return {
    status,
    auto: typeof raw?.auto === "boolean" ? raw.auto : base.auto,
    title: typeof raw?.title === "string" ? raw.title : null,
    cycleIndex: typeof raw?.cycleIndex === "number" ? raw.cycleIndex : base.cycleIndex,
    autoTurnsSent: typeof raw?.autoTurnsSent === "number" ? raw.autoTurnsSent : base.autoTurnsSent,
    requiresHuman: typeof raw?.requiresHuman === "boolean" ? raw.requiresHuman : base.requiresHuman,
    lastPromptAt: typeof raw?.lastPromptAt === "string" ? raw.lastPromptAt : null,
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : base.updatedAt,
  };
}

export function writeState(cwd: string, patch: Partial<AutoscopeState>): AutoscopeState {
  const paths = autoscopePaths(cwd);
  ensureDir(paths.root);
  const state = { ...readState(cwd), ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(paths.state, JSON.stringify(state, null, 2) + "\n");
  return state;
}

export function ensureWorkspace(cwd: string, title = "Untitled research", abstract = ""): AutoscopePaths {
  const paths = autoscopePaths(cwd);
  ensureDir(paths.root);
  ensureDir(paths.cyclesDir);
  ensureDir(paths.reportsDir);
  ensureDir(paths.selfPromptsDir);
  ensureDir(paths.artifactsDir);

  writeIfMissing(paths.config, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
  writeIfMissing(paths.state, JSON.stringify(defaultState(title), null, 2) + "\n");
  writeIfMissing(paths.goal, [
    `# Goal: ${title}`,
    "",
    "## Baseline abstract",
    abstract.trim() || "_Not provided yet._",
    "",
    "## Evolving goal",
    "Refine this section as evidence accumulates. Preserve the baseline abstract above.",
    "",
    "## Decision log",
    "- Initial workspace created.",
    "",
  ].join("\n"));
  writeIfMissing(paths.plan, [
    "# Research Plan",
    "",
    "Keep this file current after every cycle.",
    "",
    "## Current high-level cycle",
    "1. Analyze and gather data; refine goals.",
    "2. Run focused work subcycles.",
    "3. Compile findings and re-evaluate next steps.",
    "",
    "## Active plan",
    "- [ ] Establish the first evidence-backed research questions.",
    "",
  ].join("\n"));
  writeIfMissing(paths.backlog, "# Backlog\n\n- [ ] Decompose the next research subcycle.\n");
  writeIfMissing(paths.questions, "# Open Questions\n\n");
  writeIfMissing(paths.interesting, "# Interesting Observations\n\nCapture surprising links, anomalies, weak signals, and side hypotheses here.\n");
  writeIfMissing(paths.sources, "");
  writeIfMissing(paths.evidence, "");
  writeIfMissing(paths.events, "");
  writeIfMissing(paths.nextCycle, defaultNextCyclePrompt());
  return paths;
}

export function inferTitle(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) return "Untitled research";
  return normalized.length > 72 ? normalized.slice(0, 69).trimEnd() + "…" : normalized;
}

export function defaultNextCyclePrompt(): string {
  return [
    "Continue the Autoscope research loop for this workspace.",
    "",
    "Required actions:",
    "1. Read `.autoscope/goal.md`, `.autoscope/plan.md`, `.autoscope/backlog.md`, `.autoscope/interesting.md`, and recent `.autoscope/cycles/*` as needed.",
    "2. Run one focused subcycle: short-term task selection → subagent/resource plan → work → compile/analyze → re-evaluate.",
    "3. Update the living artifacts: goal/plan/backlog/questions/interesting/sources/evidence.",
    "4. Write a new cycle report under `.autoscope/cycles/` and refresh `.autoscope/self-prompts/next-cycle.md`.",
    "5. Update `.autoscope/state.json` with the new cycleIndex and status. Keep status `running` unless a stop condition is met.",
  ].join("\n");
}

export function composeStartMessage(abstract: string): string {
  return `/skill:autoscope ${abstract}`.trim();
}

export function composeCycleMessage(reason = "auto-resume"): string {
  return [
    `Autoscope ${reason}: continue the next autonomous research cycle now.`,
    "Use `.autoscope/` as the source of truth, prefer the current `.autoscope/self-prompts/next-cycle.md` if present, update all living artifacts, and stop only if a configured stop condition or safety gate applies.",
  ].join(" ");
}
