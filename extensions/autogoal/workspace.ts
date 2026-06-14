import * as fs from "node:fs";
import * as path from "node:path";

export const AUTOGOAL_DIR = ".autogoal";

export type AutogoalStatus = "idle" | "running" | "paused" | "stopped";
export type AutogoalMode = "research" | "development" | "optimization";

export const AUTOGOAL_MODES: AutogoalMode[] = ["research", "development", "optimization"];

export interface AutogoalConfig {
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
  worktrees: {
    enabled: boolean;
    root: string;
    branchPrefix: string;
    cleanupMerged: boolean;
  };
  subagents: {
    enabled: boolean;
    preferredAgents: string[];
    useAcceptance: boolean;
    useIntercom: boolean;
    maxParallel: number;
    timeoutPolicy: string;
  };
}

export interface AutogoalState {
  status: AutogoalStatus;
  mode: AutogoalMode;
  auto: boolean;
  title: string | null;
  metric: string | null;
  repository: string | null;
  branch: string | null;
  worktreePath: string | null;
  cycleIndex: number;
  autoTurnsSent: number;
  requiresHuman: boolean;
  lastPromptAt: string | null;
  updatedAt: string;
}

export interface AutogoalPaths {
  root: string;
  config: string;
  state: string;
  goal: string;
  plan: string;
  backlog: string;
  questions: string;
  leads: string;
  sources: string;
  findings: string;
  legacyInteresting: string;
  legacyEvidence: string;
  events: string;
  modeGuide: string;
  subagentsGuide: string;
  metrics: string;
  cyclesDir: string;
  reportsDir: string;
  selfPromptsDir: string;
  nextCycle: string;
  artifactsDir: string;
}

export const DEFAULT_CONFIG: AutogoalConfig = {
  autonomy: "full",
  maxAutoTurns: 50,
  maxCycles: 50,
  maxNoProgressCycles: 5,
  reviewEveryCycles: 3,
  oracleEveryCycles: 5,
  requireHumanOnGoalShift: false,
  settleMs: 800,
  stopIfRequiresHuman: true,
  defaultCycleBudget: "one focused subcycle unless findings require more",
  worktrees: {
    enabled: true,
    root: "../.autogoal-worktrees",
    branchPrefix: "autogoal/",
    cleanupMerged: false,
  },
  subagents: {
    enabled: true,
    preferredAgents: ["scout", "planner", "worker", "reviewer", "oracle", "researcher", "delegate"],
    useAcceptance: true,
    useIntercom: true,
    maxParallel: 4,
    timeoutPolicy: "no-timeout-by-default; if required, use an intentionally high limit and document why",
  },
};

export function normalizeMode(value: unknown, fallback: AutogoalMode = "research"): AutogoalMode {
  const mode = String(value ?? "").toLowerCase();
  if (mode === "dev" || mode === "development" || mode === "code") return "development";
  if (mode === "opt" || mode === "optimize" || mode === "optimization") return "optimization";
  if (mode === "research" || mode === "res" || mode === "autoreserch" || mode === "autoresarch") return "research";
  return fallback;
}

export function modeTitle(mode: AutogoalMode): string {
  if (mode === "development") return "Development";
  if (mode === "optimization") return "Optimization";
  return "Research";
}

export function defaultState(title: string | null = null, mode: AutogoalMode = "research"): AutogoalState {
  return {
    status: "idle",
    mode,
    auto: false,
    title,
    metric: null,
    repository: null,
    branch: null,
    worktreePath: null,
    cycleIndex: 0,
    autoTurnsSent: 0,
    requiresHuman: false,
    lastPromptAt: null,
    updatedAt: new Date().toISOString(),
  };
}

export function autogoalPaths(cwd: string): AutogoalPaths {
  const root = path.join(cwd, AUTOGOAL_DIR);
  const selfPromptsDir = path.join(root, "self-prompts");
  return {
    root,
    config: path.join(root, "config.json"),
    state: path.join(root, "state.json"),
    goal: path.join(root, "goal.md"),
    plan: path.join(root, "plan.md"),
    backlog: path.join(root, "backlog.md"),
    questions: path.join(root, "questions.md"),
    leads: path.join(root, "leads.md"),
    sources: path.join(root, "sources.jsonl"),
    findings: path.join(root, "findings.jsonl"),
    legacyInteresting: path.join(root, "interesting.md"),
    legacyEvidence: path.join(root, "evidence.jsonl"),
    events: path.join(root, "events.jsonl"),
    modeGuide: path.join(root, "mode.md"),
    subagentsGuide: path.join(root, "subagents.md"),
    metrics: path.join(root, "metrics.jsonl"),
    cyclesDir: path.join(root, "cycles"),
    reportsDir: path.join(root, "reports"),
    selfPromptsDir,
    nextCycle: path.join(selfPromptsDir, "next-cycle.md"),
    artifactsDir: path.join(root, "artifacts"),
  };
}

export function workspaceExists(cwd: string): boolean {
  return fs.existsSync(autogoalPaths(cwd).root);
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function writeIfMissing(file: string, content: string): void {
  if (!fs.existsSync(file)) fs.writeFileSync(file, content);
}

function writeFiles(files: Array<[string, string]>, mode: "missing" | "overwrite"): void {
  for (const [file, content] of files) {
    if (mode === "overwrite") fs.writeFileSync(file, content);
    else writeIfMissing(file, content);
  }
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

export function readConfig(cwd: string): AutogoalConfig {
  const raw = readJsonObject(autogoalPaths(cwd).config);
  const worktrees = raw?.worktrees && typeof raw.worktrees === "object" && !Array.isArray(raw.worktrees)
    ? raw.worktrees as Record<string, unknown>
    : {};
  const subagents = raw?.subagents && typeof raw.subagents === "object" && !Array.isArray(raw.subagents)
    ? raw.subagents as Record<string, unknown>
    : {};
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
    worktrees: {
      enabled: typeof worktrees.enabled === "boolean" ? worktrees.enabled : DEFAULT_CONFIG.worktrees.enabled,
      root: typeof worktrees.root === "string" ? worktrees.root : DEFAULT_CONFIG.worktrees.root,
      branchPrefix: typeof worktrees.branchPrefix === "string" ? worktrees.branchPrefix : DEFAULT_CONFIG.worktrees.branchPrefix,
      cleanupMerged: typeof worktrees.cleanupMerged === "boolean" ? worktrees.cleanupMerged : DEFAULT_CONFIG.worktrees.cleanupMerged,
    },
    subagents: {
      enabled: typeof subagents.enabled === "boolean" ? subagents.enabled : DEFAULT_CONFIG.subagents.enabled,
      preferredAgents: Array.isArray(subagents.preferredAgents) ? subagents.preferredAgents.filter((x): x is string => typeof x === "string") : DEFAULT_CONFIG.subagents.preferredAgents,
      useAcceptance: typeof subagents.useAcceptance === "boolean" ? subagents.useAcceptance : DEFAULT_CONFIG.subagents.useAcceptance,
      useIntercom: typeof subagents.useIntercom === "boolean" ? subagents.useIntercom : DEFAULT_CONFIG.subagents.useIntercom,
      maxParallel: typeof subagents.maxParallel === "number" ? subagents.maxParallel : DEFAULT_CONFIG.subagents.maxParallel,
      timeoutPolicy: typeof subagents.timeoutPolicy === "string" ? subagents.timeoutPolicy : DEFAULT_CONFIG.subagents.timeoutPolicy,
    },
  };
}

export function readState(cwd: string): AutogoalState {
  const raw = readJsonObject(autogoalPaths(cwd).state);
  const base = defaultState();
  const status = ["idle", "running", "paused", "stopped"].includes(String(raw?.status))
    ? raw!.status as AutogoalStatus
    : base.status;
  return {
    status,
    mode: normalizeMode(raw?.mode, base.mode),
    auto: typeof raw?.auto === "boolean" ? raw.auto : base.auto,
    title: typeof raw?.title === "string" ? raw.title : null,
    metric: typeof raw?.metric === "string" ? raw.metric : null,
    repository: typeof raw?.repository === "string" ? raw.repository : null,
    branch: typeof raw?.branch === "string" ? raw.branch : null,
    worktreePath: typeof raw?.worktreePath === "string" ? raw.worktreePath : null,
    cycleIndex: typeof raw?.cycleIndex === "number" ? raw.cycleIndex : base.cycleIndex,
    autoTurnsSent: typeof raw?.autoTurnsSent === "number" ? raw.autoTurnsSent : base.autoTurnsSent,
    requiresHuman: typeof raw?.requiresHuman === "boolean" ? raw.requiresHuman : base.requiresHuman,
    lastPromptAt: typeof raw?.lastPromptAt === "string" ? raw.lastPromptAt : null,
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : base.updatedAt,
  };
}

export function writeState(cwd: string, patch: Partial<AutogoalState>): AutogoalState {
  const paths = autogoalPaths(cwd);
  ensureDir(paths.root);
  const state = { ...readState(cwd), ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(paths.state, JSON.stringify(state, null, 2) + "\n");
  return state;
}

function activeGoalFiles(paths: AutogoalPaths, title: string, abstract: string, mode: AutogoalMode, metric = ""): Array<[string, string]> {
  return [
    [paths.goal, [
      `# Goal: ${title}`,
      "",
      `Mode: ${modeTitle(mode)}`,
      "",
      "## Baseline abstract",
      abstract.trim() || "_Not provided yet._",
      "",
      "## Evolving goal",
      mode === "development"
        ? "Deliver working code in verified, reviewable git commits. Keep durable output in git history rather than ad-hoc artifacts."
        : mode === "optimization"
          ? "Improve the target metric through findings-backed experiments. Preserve the baseline abstract above."
          : "Refine this section as findings accumulate. Preserve the baseline abstract above.",
      ...(mode === "optimization" ? ["", "## Target metric", metric.trim() || "Define the metric, baseline, measurement command, and target delta."] : []),
      "",
      "## Decision log",
      "- Active goal started.",
      "",
    ].join("\n")],
    [paths.plan, [
      `# ${modeTitle(mode)} Plan`,
      "",
      "Keep this file current after every cycle.",
      "",
      "## Current high-level cycle",
      ...defaultPlanSteps(mode),
      "",
      "## Active plan",
      defaultPlanItem(mode),
      "",
    ].join("\n")],
    [paths.backlog, `# Backlog\n\n- [ ] Decompose the next ${mode} subcycle.\n`],
    [paths.modeGuide, defaultModeGuide(mode)],
    [paths.subagentsGuide, defaultSubagentsGuide(mode)],
    [paths.nextCycle, defaultNextCyclePrompt(mode)],
  ];
}

function genericWorkspaceFiles(paths: AutogoalPaths, title: string): Array<[string, string]> {
  return [
    [paths.goal, [
      `# ${title}`,
      "",
      "No active Autogoal goal has been started in this folder yet.",
      "",
      "Start one with `/autogoal start [research|dev|optimize] <goal>`.",
      "",
      "## Notes",
      "- Workspace initialized.",
      "",
    ].join("\n")],
    [paths.plan, "# Autogoal Plan\n\nNo active plan yet. Start a goal to create a mode-specific plan.\n"],
    [paths.backlog, "# Backlog\n\nNo active backlog yet. Start a goal to seed mode-specific work.\n"],
    [paths.questions, "# Open Questions\n\n"],
    [paths.leads, "# Leads\n\nCapture promising but unverified follow-up ideas, anomalies, weak signals, and side hypotheses here.\n"],
    [paths.modeGuide, "# Autogoal Mode\n\nNo active mode yet. Choose one with `/autogoal start research|dev|optimize <goal>`.\n"],
    [paths.subagentsGuide, defaultSubagentsGuide("research")],
    [paths.nextCycle, "No Autogoal goal is running. Start one with `/autogoal start [research|dev|optimize] <goal>`.\n"],
  ];
}

function ensureWorkspaceDirs(paths: AutogoalPaths): void {
  ensureDir(paths.root);
  ensureDir(paths.cyclesDir);
  ensureDir(paths.reportsDir);
  ensureDir(paths.selfPromptsDir);
  ensureDir(paths.artifactsDir);
}

export function defaultWorkspaceTitle(cwd: string): string {
  const folder = path.basename(path.resolve(cwd)) || "current folder";
  return `Autogoal workspace: ${folder}`;
}

export function ensureGenericWorkspace(cwd: string, title = defaultWorkspaceTitle(cwd)): AutogoalPaths {
  const paths = autogoalPaths(cwd);
  ensureWorkspaceDirs(paths);
  writeIfMissing(paths.config, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
  writeIfMissing(paths.state, JSON.stringify(defaultState(title, "research"), null, 2) + "\n");
  writeFiles(genericWorkspaceFiles(paths, title), "missing");
  writeIfMissing(paths.sources, "");
  writeIfMissing(paths.findings, "");
  writeIfMissing(paths.metrics, "");
  writeIfMissing(paths.events, "");
  return paths;
}

export function writeActiveGoalFiles(cwd: string, title: string, abstract: string, mode: AutogoalMode, metric = ""): AutogoalPaths {
  const paths = autogoalPaths(cwd);
  ensureWorkspaceDirs(paths);
  writeFiles(activeGoalFiles(paths, title, abstract, mode, metric), "overwrite");
  return paths;
}

export function ensureWorkspace(cwd: string, title = "Untitled goal", abstract = "", mode: AutogoalMode = "research", metric = ""): AutogoalPaths {
  const paths = autogoalPaths(cwd);
  ensureWorkspaceDirs(paths);

  writeIfMissing(paths.config, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
  writeIfMissing(paths.state, JSON.stringify({ ...defaultState(title, mode), metric: metric || null }, null, 2) + "\n");
  writeFiles(activeGoalFiles(paths, title, abstract, mode, metric), "missing");
  writeIfMissing(paths.questions, "# Open Questions\n\n");
  writeIfMissing(paths.leads, "# Leads\n\nCapture promising but unverified follow-up ideas, anomalies, weak signals, and side hypotheses here.\n");
  writeIfMissing(paths.sources, "");
  writeIfMissing(paths.findings, "");
  writeIfMissing(paths.metrics, "");
  writeIfMissing(paths.events, "");
  return paths;
}

function defaultPlanSteps(mode: AutogoalMode): string[] {
  if (mode === "development") {
    return [
      "1. Inspect codebase and choose the smallest valuable implementation slice.",
      "2. Use a git worktree/branch when parallel or risky edits are useful.",
      "3. Implement, test, review, and commit verified changes; avoid durable ad-hoc artifacts.",
    ];
  }
  if (mode === "optimization") {
    return [
      "1. Define metric, baseline, measurement command, and constraints.",
      "2. Generate hypotheses and run controlled optimization experiments.",
      "3. Compare metric deltas, keep winners, and re-evaluate next experiments.",
    ];
  }
  return [
    "1. Analyze and gather data; refine goals.",
    "2. Run focused work subcycles.",
    "3. Compile findings and re-evaluate next steps.",
  ];
}

function defaultPlanItem(mode: AutogoalMode): string {
  if (mode === "development") return "- [ ] Establish the first implement-test-review-commit slice.";
  if (mode === "optimization") return "- [ ] Establish baseline metric and first experiment queue.";
  return "- [ ] Establish the first findings-backed research questions.";
}

export function defaultModeGuide(mode: AutogoalMode): string {
  if (mode === "development") return [
    "# Development Mode",
    "",
    "Primary loop: inspect → plan slice → implement → test/lint/typecheck → review → commit → select next slice.",
    "Durability rule: do not create long-lived reports/artifacts for normal progress. Use git commits and concise `.autogoal/events.jsonl` records.",
    "Use git worktrees for isolated branches when work is parallel, risky, or needs reviewer/worker separation.",
    "Do not push, publish, deploy, rename remote repositories, or mutate external systems unless the user explicitly authorizes that action.",
    "",
  ].join("\n");
  if (mode === "optimization") return [
    "# Optimization Mode",
    "",
    "Primary loop: define metric → measure baseline → form hypotheses → run experiments → compare deltas → keep/revert → choose next experiment.",
    "Log metric observations in `.autogoal/metrics.jsonl`, sources in `.autogoal/sources.jsonl`, and findings in `.autogoal/findings.jsonl`.",
    "Prefer controlled experiments, reproducible commands, and explicit stop conditions.",
    "Use subagents for hypothesis generation, experiment implementation, review, and consistency checks.",
    "",
  ].join("\n");
  return [
    "# Research Mode",
    "",
    "Primary loop: refine questions → gather sources → synthesize findings → capture leads → update next prompt.",
    "Persist sources, findings, leads, cycle reports, and self-prompts under `.autogoal/`.",
    "Use subagents for scouting, parallel research, review, and oracle consistency checks when useful.",
    "",
  ].join("\n");
}

export function defaultSubagentsGuide(mode: AutogoalMode): string {
  const acceptance = mode === "development"
    ? "For worker handoffs, include acceptance criteria, changed-files/diff-summary evidence, and verification commands."
    : "For broad or risky handoffs, include explicit acceptance criteria and verification evidence.";
  return [
    "# Subagents Integration",
    "",
    "Recommended roles:",
    "- `scout`: fast context gathering over code/docs.",
    "- `planner`: implementation/research/experiment plan.",
    "- `worker`: isolated implementation, preferably in a git worktree for code changes.",
    "- `reviewer`: diff, plan, and findings/source review.",
    "- `oracle`: consistency check for long-running goals and hidden assumptions.",
    "- `researcher`/`delegate`: focused external research or lightweight tasks.",
    "",
    acceptance,
    "Use pi-intercom/contact_supervisor when a child agent needs blocking decisions or progress-changing updates.",
    "",
  ].join("\n");
}

export function inferTitle(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) return "Untitled goal";
  return normalized.length > 72 ? normalized.slice(0, 69).trimEnd() + "…" : normalized;
}

export function defaultNextCyclePrompt(mode: AutogoalMode = "research"): string {
  if (mode === "development") {
    return [
      "Continue the Autogoal development loop for this workspace.",
      "",
      "Required actions:",
      "1. Read `.autogoal/goal.md`, `.autogoal/plan.md`, `.autogoal/backlog.md`, `.autogoal/mode.md`, `.autogoal/subagents.md`, and git status/log.",
      "2. Pick one small implementation slice; use git worktrees/subagents for isolated or parallel work when useful.",
      "3. Implement, run relevant tests/lint/typecheck, review the diff, and create a git commit for verified code changes.",
      "4. Do not write durable reports/artifacts for normal progress; update only concise state/backlog/events/self-prompt as needed.",
      "5. Update `.autogoal/state.json` and `.autogoal/self-prompts/next-cycle.md`. Stop only for safety gates or configured limits.",
    ].join("\n");
  }
  if (mode === "optimization") {
    return [
      "Continue the Autogoal optimization loop for this workspace.",
      "",
      "Required actions:",
      "1. Read `.autogoal/goal.md`, `.autogoal/plan.md`, `.autogoal/backlog.md`, `.autogoal/mode.md`, recent cycles, findings, leads, sources, and metrics.",
      "2. Confirm the metric/baseline or run a measurement, then choose one high-leverage experiment.",
      "3. Use subagents/worktrees for hypothesis generation, implementation, and review when useful.",
      "4. Record metric observations in `.autogoal/metrics.jsonl`, findings in `.autogoal/findings.jsonl`, and leads in `.autogoal/leads.md`.",
      "5. Update `.autogoal/state.json` and `.autogoal/self-prompts/next-cycle.md` with next experiment and stop conditions.",
    ].join("\n");
  }
  return [
    "Continue the Autogoal research loop for this workspace.",
    "",
    "Required actions:",
    "1. Read `.autogoal/goal.md`, `.autogoal/plan.md`, `.autogoal/backlog.md`, `.autogoal/leads.md`, and recent `.autogoal/cycles/*` as needed.",
    "2. Run one focused subcycle: short-term task selection → subagent/resource plan → work → compile/analyze → re-evaluate.",
    "3. Update the living artifacts: goal/plan/backlog/questions/leads/sources/findings.",
    "4. Write a new cycle report under `.autogoal/cycles/` and refresh `.autogoal/self-prompts/next-cycle.md`.",
    "5. Update `.autogoal/state.json` with the new cycleIndex and status. Keep status `running` unless a stop condition is met.",
  ].join("\n");
}

export function composeStartMessage(abstract: string, mode: AutogoalMode = "research"): string {
  const goal = abstract.trim();
  const modeAction = mode === "development"
    ? "implement → test → review → commit"
    : mode === "optimization"
      ? "measure → experiment → compare metric deltas"
      : "research → synthesize findings → capture leads";
  return [
    `Autogoal start: begin the first autonomous ${mode} cycle now.`,
    "",
    "Use the `autogoal` skill and treat `.autogoal/` in the current folder as the source of truth.",
    "",
    "Goal:",
    goal,
    "",
    `Mode-specific loop: ${modeAction}.`,
    "Initialize or refresh missing `.autogoal/` files, read the active goal/plan/backlog/mode guide, run one focused first cycle, persist state, and refresh `.autogoal/self-prompts/next-cycle.md`.",
    "Keep `.autogoal/state.json` status `running` unless a safety gate or configured stop condition applies.",
  ].join("\n");
}

export function composeCycleMessage(reason = "auto-resume", mode: AutogoalMode = "research"): string {
  return [
    `Autogoal ${reason}: continue the next autonomous ${mode} cycle now.`,
    "Use `.autogoal/` as the source of truth, prefer the current `.autogoal/self-prompts/next-cycle.md` if present, update all living artifacts, and stop only if a configured stop condition or safety gate applies.",
  ].join(" ");
}
