import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildAutogoalCompactionSummary } from "./compaction.ts";
import { appendEvent, appendJsonl, countJsonl, tailJsonl } from "./jsonl.ts";
import { hookMessage, logHook, runAutogoalHook } from "./hooks.ts";
import { assistantLimitExhaustionReason, containsTruncationMarker } from "./safety.ts";
import {
  composeCycleMessage,
  composeStartMessage,
  ensureWorkspace,
  inferTitle,
  modeTitle,
  normalizeMode,
  AUTOGOAL_DIR,
  type AutogoalMode,
  autogoalPaths,
  readConfig,
  readState,
  workspaceExists,
  writeState,
} from "./workspace.ts";

interface Runtime {
  pendingTimer: ReturnType<typeof setTimeout> | null;
  lastPromptedCycleIndex: number;
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const stringProp = (description: string) => ({ type: "string", description });
const boolProp = (description: string) => ({ type: "boolean", description });
const numberProp = (description: string) => ({ type: "number", description });

function help(): string {
  return [
    "Autogoal commands:",
    "  /autogoal init [mode] [title]        create .autogoal workspace",
    "  /autogoal start [mode] <goal>        start autonomous goal loop",
    "  /autogoal research <goal>            start research mode",
    "  /autogoal dev <goal>                 start development mode",
    "  /autogoal optimize <metric/goal>     start optimization mode",
    "  /autogoal cycle [focus]              run one next-cycle prompt",
    "  /autogoal pause|resume|off|status    manage auto-resume",
  ].join("\n");
}

function parseModePayload(args: string, fallback: AutogoalMode = "research"): { mode: AutogoalMode; payload: string } {
  const trimmed = args.trim();
  const [first = "", ...rest] = trimmed.split(/\s+/);
  const parsed = normalizeMode(first, fallback);
  if (first && parsed !== fallback || ["research", "res", "dev", "development", "code", "opt", "optimize", "optimization"].includes(first.toLowerCase())) {
    return { mode: parsed, payload: rest.join(" ").trim() };
  }
  return { mode: fallback, payload: trimmed };
}

function sessionKey(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionId();
}

function sendWhenReady(pi: ExtensionAPI, ctx: ExtensionContext, message: string): void {
  if (ctx.isIdle()) pi.sendUserMessage(message);
  else pi.sendUserMessage(message, { deliverAs: "followUp" });
}

function cycleFileName(index: number): string {
  return `cycle-${String(index).padStart(3, "0")}.md`;
}

function safeBranchFragment(input: string): string {
  const slug = input.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return slug || "goal";
}

function gitOutput(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function currentBranch(cwd: string): string | null {
  try {
    return gitOutput(cwd, ["branch", "--show-current"]) || null;
  } catch {
    return null;
  }
}

function createWorktree(cwd: string, mode: AutogoalMode, name: string): { path: string; branch: string } {
  const config = readConfig(cwd);
  const root = path.resolve(cwd, config.worktrees.root);
  fs.mkdirSync(root, { recursive: true });
  const suffix = Date.now().toString(36);
  const branch = `${config.worktrees.branchPrefix}${mode}/${safeBranchFragment(name)}-${suffix}`;
  const worktreePath = path.join(root, `${safeBranchFragment(`${mode}-${name}`)}-${suffix}`);
  gitOutput(cwd, ["worktree", "add", "-b", branch, worktreePath]);
  return { path: worktreePath, branch };
}

function markdownCycle(params: Record<string, unknown>, index: number): string {
  const lines = [
    `# Cycle ${index} — ${String(params.title ?? "Research cycle")}`,
    "",
    "## Summary",
    String(params.summary ?? ""),
    "",
    "## Findings",
    String(params.findings ?? ""),
    "",
    "## Interesting observations",
    String(params.interesting ?? ""),
    "",
    "## Checks / validation",
    String(params.checks ?? ""),
    "",
    "## Next",
    String(params.nextPrompt ?? ""),
    "",
  ];
  if (params.nextPromptFile || params.artifacts) {
    lines.push(
      "## Artifact files",
      String(params.artifacts ?? params.nextPromptFile ?? ""),
      "",
    );
  }
  return lines.join("\n");
}

function latestAssistantLimitReason(messages: unknown[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || typeof message !== "object" || (message as Record<string, unknown>).role !== "assistant") continue;
    return assistantLimitExhaustionReason(message);
  }
  return null;
}

export function resolveAutogoalFile(cwd: string, candidate: string): { ok: true; path: string } | { ok: false; error: string } {
  const root = autogoalPaths(cwd).root;
  const resolved = path.resolve(cwd, candidate);
  let rootReal: string;
  let stat: fs.Stats;
  let fileReal: string;

  try {
    rootReal = fs.realpathSync(root);
  } catch (error) {
    return { ok: false, error: `${AUTOGOAL_DIR}/ is not accessible: ${error instanceof Error ? error.message : String(error)}` };
  }

  try {
    stat = fs.lstatSync(resolved);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
    if (code === "ENOENT") return { ok: false, error: `nextPromptFile does not exist: ${candidate}` };
    return { ok: false, error: `nextPromptFile is not accessible: ${candidate}: ${error instanceof Error ? error.message : String(error)}` };
  }

  if (stat.isSymbolicLink()) return { ok: false, error: `nextPromptFile must not be a symbolic link: ${candidate}` };
  if (!stat.isFile()) return { ok: false, error: `nextPromptFile must be a regular file: ${candidate}` };

  try {
    fileReal = fs.realpathSync(resolved);
  } catch (error) {
    return { ok: false, error: `nextPromptFile is not accessible: ${candidate}: ${error instanceof Error ? error.message : String(error)}` };
  }

  const relative = path.relative(rootReal, fileReal);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { ok: false, error: `nextPromptFile must point inside ${AUTOGOAL_DIR}/` };
  }

  return { ok: true, path: fileReal };
}

export function readNextPromptInput(cwd: string, params: Record<string, unknown>): { ok: true; text: string; file?: string } | { ok: false; error: string } {
  const p = autogoalPaths(cwd);
  const fileParam = typeof params.nextPromptFile === "string" ? params.nextPromptFile.trim() : "";
  if (fileParam) {
    const resolved = resolveAutogoalFile(cwd, fileParam);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    let text: string;
    try {
      text = fs.readFileSync(resolved.path, "utf-8").trim();
    } catch (error) {
      return { ok: false, error: `Failed to read nextPromptFile: ${fileParam}: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (!text) return { ok: false, error: `nextPromptFile is empty: ${fileParam}` };
    if (containsTruncationMarker(text)) return { ok: false, error: `nextPromptFile appears to contain a truncation marker: ${fileParam}` };
    return { ok: true, text, file: fileParam };
  }

  const inline = typeof params.nextPrompt === "string" ? params.nextPrompt.trim() : "";
  if (inline) {
    if (containsTruncationMarker(inline)) return { ok: false, error: "nextPrompt appears to contain a truncation marker; write the full prompt to .autogoal/self-prompts/next-cycle.md and call log_goal_cycle with nextPromptFile instead" };
    return { ok: true, text: inline };
  }

  return { ok: false, error: `Provide nextPrompt or nextPromptFile (for example ${path.relative(cwd, p.nextCycle)})` };
}

function statusText(ctx: ExtensionContext): string {
  const state = readState(ctx.cwd);
  const config = readConfig(ctx.cwd);
  const p = autogoalPaths(ctx.cwd);
  const modeExtra = state.mode === "optimization" ? ` · metrics ${countJsonl(p.metrics)}` : state.mode === "development" ? ` · commits ${countJsonl(p.commits)}` : "";
  return `Autogoal ${state.mode}/${state.status} · cycle ${state.cycleIndex}/${config.maxCycles} · auto ${state.autoTurnsSent}/${config.maxAutoTurns} · sources ${countJsonl(p.sources)} · evidence ${countJsonl(p.evidence)}${modeExtra} · human=${state.requiresHuman}`;
}

function setAutogoalStatus(ctx: ExtensionContext): void {
  if (!workspaceExists(ctx.cwd)) {
    ctx.ui.setStatus?.("autogoal", undefined);
    return;
  }
  ctx.ui.setStatus?.("autogoal", statusText(ctx));
}

export default function autogoalExtension(pi: ExtensionAPI) {
  const runtimes = new Map<string, Runtime>();
  const gatedToolNames = new Set<string>();

  const runtimeFor = (ctx: ExtensionContext): Runtime => {
    const key = sessionKey(ctx);
    let runtime = runtimes.get(key);
    if (!runtime) {
      runtime = { pendingTimer: null, lastPromptedCycleIndex: workspaceExists(ctx.cwd) ? readState(ctx.cwd).cycleIndex : -1 };
      runtimes.set(key, runtime);
    }
    return runtime;
  };

  const setAutogoalTools = (ctx: ExtensionContext, enabled: boolean): void => {
    const active = new Set(pi.getActiveTools());
    for (const name of gatedToolNames) enabled ? active.add(name) : active.delete(name);
    pi.setActiveTools([...active]);
    setAutogoalStatus(ctx);
  };

  const registerGatedTool = (tool: Parameters<typeof pi.registerTool>[0]): void => {
    gatedToolNames.add(tool.name);
    pi.registerTool(tool);
  };

  const clearTimer = (ctx: ExtensionContext): void => {
    const runtime = runtimeFor(ctx);
    if (runtime.pendingTimer) clearTimeout(runtime.pendingTimer);
    runtime.pendingTimer = null;
  };

  const markCyclePromptSent = (ctx: ExtensionContext, cycleIndex = readState(ctx.cwd).cycleIndex): void => {
    runtimeFor(ctx).lastPromptedCycleIndex = Math.max(runtimeFor(ctx).lastPromptedCycleIndex, cycleIndex);
  };

  const pauseForLimitExhaustion = (ctx: ExtensionContext, reason: string): void => {
    clearTimer(ctx);
    const usage = ctx.getContextUsage();
    writeState(ctx.cwd, { status: "paused", auto: false, requiresHuman: true });
    appendEvent(autogoalPaths(ctx.cwd).events, "limit-exhausted", {
      reason,
      contextTokens: usage?.tokens ?? null,
      contextWindow: usage?.contextWindow ?? null,
      contextPercent: usage?.percent ?? null,
    });
    setAutogoalTools(ctx, true);
    ctx.ui.notify(`Autogoal paused: ${reason}. Fix the token/quota issue, then /autogoal resume.`, "warning");
  };

  const fireBeforeHook = async (ctx: ExtensionContext, reason: string): Promise<void> => {
    const state = readState(ctx.cwd);
    const p = autogoalPaths(ctx.cwd);
    const result = await runAutogoalHook(ctx.cwd, "before-cycle", { reason, mode: state.mode, state, recentEvidence: tailJsonl(p.evidence, 5), recentMetrics: tailJsonl(p.metrics, 5), recentCommits: tailJsonl(p.commits, 5) });
    logHook(ctx.cwd, "before-cycle", result);
    const message = hookMessage("before-cycle", result);
    if (message) pi.sendUserMessage(message, { deliverAs: "steer" });
  };

  const scheduleNext = (ctx: ExtensionContext, reason = "auto-resume"): void => {
    if (!workspaceExists(ctx.cwd)) return;
    const config = readConfig(ctx.cwd);
    const state = readState(ctx.cwd);
    if (state.status !== "running" || !state.auto) return;
    const runtime = runtimeFor(ctx);
    if (state.cycleIndex <= runtime.lastPromptedCycleIndex) return;
    if (config.stopIfRequiresHuman && state.requiresHuman) {
      writeState(ctx.cwd, { status: "paused", auto: false });
      setAutogoalTools(ctx, false);
      ctx.ui.notify("Autogoal paused: state.requiresHuman=true", "warning");
      return;
    }
    if (state.autoTurnsSent >= config.maxAutoTurns || state.cycleIndex >= config.maxCycles) {
      writeState(ctx.cwd, { status: "paused", auto: false });
      setAutogoalTools(ctx, false);
      ctx.ui.notify("Autogoal paused: configured auto/cycle limit reached", "info");
      return;
    }
    clearTimer(ctx);
    runtime.pendingTimer = setTimeout(async () => {
      if (!ctx.isIdle() || ctx.hasPendingMessages()) return scheduleNext(ctx, reason);
      const latest = readState(ctx.cwd);
      if (latest.status !== "running" || !latest.auto) return;
      if (latest.cycleIndex <= runtime.lastPromptedCycleIndex) return;
      writeState(ctx.cwd, {
        autoTurnsSent: latest.autoTurnsSent + 1,
        lastPromptAt: new Date().toISOString(),
      });
      markCyclePromptSent(ctx, latest.cycleIndex);
      await fireBeforeHook(ctx, reason);
      pi.sendUserMessage(composeCycleMessage(reason, latest.mode));
    }, config.settleMs);
  };

  pi.on("session_start", async (_event, ctx) => {
    const active = workspaceExists(ctx.cwd) && ["running", "paused"].includes(readState(ctx.cwd).status);
    runtimeFor(ctx).lastPromptedCycleIndex = workspaceExists(ctx.cwd) ? readState(ctx.cwd).cycleIndex : -1;
    setAutogoalTools(ctx, active);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    clearTimer(ctx);
    runtimes.delete(sessionKey(ctx));
  });

  pi.on("agent_start", async (_event, ctx) => {
    clearTimer(ctx);
  });

  pi.on("session_before_compact", async (event, ctx) => {
    if (!workspaceExists(ctx.cwd)) return;
    const state = readState(ctx.cwd);
    if (state.status !== "running" && state.status !== "paused") return;
    return {
      compaction: {
        summary: buildAutogoalCompactionSummary(ctx.cwd),
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
      },
    };
  });

  pi.on("session_compact", async (_event, ctx) => {
    scheduleNext(ctx, "compaction");
  });

  pi.on("agent_end", async (event, ctx) => {
    setAutogoalStatus(ctx);
    const reason = latestAssistantLimitReason(event.messages as unknown[]);
    if (reason && workspaceExists(ctx.cwd)) {
      pauseForLimitExhaustion(ctx, reason);
      return;
    }
    scheduleNext(ctx, "agent_end");
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!workspaceExists(ctx.cwd)) return;
    const state = readState(ctx.cwd);
    if (state.status !== "running" && state.status !== "paused") return;
    const paths = autogoalPaths(ctx.cwd);
    const config = readConfig(ctx.cwd);
    const mode = state.mode;
    const extra = [
      "",
      `## Autogoal ${modeTitle(mode)} Mode`,
      `Workspace state lives in \`${AUTOGOAL_DIR}/\`. Treat these files as the source of truth, not the chat history.`,
      `Read/update: \`${paths.goal}\`, \`${paths.plan}\`, \`${paths.backlog}\`, \`${paths.modeGuide}\`, \`${paths.subagentsGuide}\`, and \`${paths.nextCycle}\`.`,
      "Use Autogoal tools when available: log_source, log_evidence, log_interesting, log_metric, log_commit, prepare_worktree, log_goal_cycle, set_goal_state.",
      mode === "development"
        ? "Development durability rule: normal progress should be durable through git commits, not long-lived reports/artifacts. Run relevant tests before committing."
        : mode === "optimization"
          ? "Optimization rule: define/measure the metric, record metric observations, compare deltas, and keep experiments reproducible."
          : "Research rule: maintain an evolving goal, evidence log, interesting observations, cycle report, and next-cycle self-prompt.",
      `Git worktrees are ${config.worktrees.enabled ? "enabled" : "disabled"}; default root is \`${config.worktrees.root}\` and branch prefix is \`${config.worktrees.branchPrefix}\`.`,
      config.subagents.enabled
        ? `Subagents are recommended for planning, implementation, review, oracle checks, and parallel research. Timeout policy: ${config.subagents.timeoutPolicy}. Preferred agents: ${config.subagents.preferredAgents.join(", ")}. Use acceptance contracts for implementation/optimization handoffs.`
        : "Subagents are disabled in config; proceed in the main agent unless the user overrides this.",
      config.subagents.useIntercom ? "Use pi-intercom/contact_supervisor for blocking child-agent decisions and meaningful progress updates." : "pi-intercom integration is disabled in config.",
      "The GitHub CLI (`gh`) may be used for GitHub work when available, but repo rename, push, publish, deploy, or other external mutations still require explicit user confirmation.",
      "Autonomy is full for in-scope local work, but safety gates still apply for destructive actions, external side effects, secrets, publishing, deploys, payments, and data deletion.",
    ].join("\n");
    return { systemPrompt: `${event.systemPrompt}\n${extra}` };
  });

  registerGatedTool({
    name: "log_source",
    label: "Log Source",
    description: "Append a source record to .autogoal/sources.jsonl.",
    parameters: objectSchema({
      title: stringProp("Source title"),
      url: stringProp("URL or local path"),
      type: stringProp("paper, docs, web, local, dataset, code, etc."),
      quality: stringProp("Quality/reliability assessment"),
      notes: stringProp("Short notes"),
    }, ["title"]),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const state = readState(ctx.cwd);
      ensureWorkspace(ctx.cwd, state.title ?? "Untitled goal", "", state.mode);
      appendJsonl(autogoalPaths(ctx.cwd).sources, { type: "source", ...params });
      return { content: [{ type: "text", text: `✅ Source logged: ${params.title}` }], details: { params } };
    },
  });

  registerGatedTool({
    name: "log_evidence",
    label: "Log Evidence",
    description: "Append an evidence record to .autogoal/evidence.jsonl.",
    parameters: objectSchema({
      claim: stringProp("Claim, observation, or result"),
      support: stringProp("Evidence supporting or refuting the claim"),
      confidence: stringProp("low, medium, high, or unknown"),
      source: stringProp("Source id/url/path if available"),
      implications: stringProp("Why this matters for the research plan"),
    }, ["claim", "support"]),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const state = readState(ctx.cwd);
      ensureWorkspace(ctx.cwd, state.title ?? "Untitled goal", "", state.mode);
      appendJsonl(autogoalPaths(ctx.cwd).evidence, { type: "evidence", ...params });
      return { content: [{ type: "text", text: `✅ Evidence logged: ${String(params.claim).slice(0, 120)}` }], details: { params } };
    },
  });

  registerGatedTool({
    name: "log_interesting",
    label: "Log Interesting",
    description: "Record an interesting observation in .autogoal/interesting.md and events.jsonl.",
    parameters: objectSchema({
      observation: stringProp("Surprising observation, weak signal, anomaly, or side hypothesis"),
      why: stringProp("Why it may matter"),
      followup: stringProp("Possible follow-up"),
    }, ["observation"]),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const state = readState(ctx.cwd);
      ensureWorkspace(ctx.cwd, state.title ?? "Untitled goal", "", state.mode);
      const p = autogoalPaths(ctx.cwd);
      fs.appendFileSync(p.interesting, `\n- **${new Date().toISOString()}** ${params.observation}${params.why ? ` — ${params.why}` : ""}${params.followup ? ` (follow-up: ${params.followup})` : ""}\n`);
      appendEvent(p.events, "interesting", params as Record<string, unknown>);
      return { content: [{ type: "text", text: "✅ Interesting observation recorded" }], details: { params } };
    },
  });

  registerGatedTool({
    name: "log_metric",
    label: "Log Metric",
    description: "Append an optimization metric observation to .autogoal/metrics.jsonl.",
    parameters: objectSchema({
      name: stringProp("Metric name"),
      value: stringProp("Measured value, including units if applicable"),
      baseline: stringProp("Baseline value if known"),
      delta: stringProp("Delta versus baseline/previous run"),
      command: stringProp("Command or procedure used to measure"),
      notes: stringProp("Short interpretation and caveats"),
    }, ["name", "value"]),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const state = readState(ctx.cwd);
      ensureWorkspace(ctx.cwd, state.title ?? "Untitled goal", "", state.mode);
      appendJsonl(autogoalPaths(ctx.cwd).metrics, { type: "metric", mode: state.mode, ...params });
      appendEvent(autogoalPaths(ctx.cwd).events, "metric", params as Record<string, unknown>);
      return { content: [{ type: "text", text: `✅ Metric logged: ${params.name}=${params.value}` }], details: { params } };
    },
  });

  registerGatedTool({
    name: "log_commit",
    label: "Log Commit",
    description: "Record a development commit in .autogoal/commits.jsonl.",
    parameters: objectSchema({
      sha: stringProp("Commit SHA"),
      branch: stringProp("Branch name"),
      summary: stringProp("What changed"),
      checks: stringProp("Tests/lint/typecheck/review performed"),
      pullRequest: stringProp("PR URL/number if created"),
    }, ["sha", "summary"]),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const state = readState(ctx.cwd);
      ensureWorkspace(ctx.cwd, state.title ?? "Untitled goal", "", state.mode);
      appendJsonl(autogoalPaths(ctx.cwd).commits, { type: "commit", mode: state.mode, ...params });
      appendEvent(autogoalPaths(ctx.cwd).events, "commit", params as Record<string, unknown>);
      return { content: [{ type: "text", text: `✅ Commit logged: ${String(params.sha).slice(0, 12)}` }], details: { params } };
    },
  });

  registerGatedTool({
    name: "prepare_worktree",
    label: "Prepare Worktree",
    description: "Create an isolated git worktree/branch for Autogoal work and record it in state.",
    parameters: objectSchema({
      name: stringProp("Short worktree purpose/name"),
      mode: stringProp("research, development, or optimization; defaults to current mode"),
    }, ["name"]),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const config = readConfig(ctx.cwd);
      if (!config.worktrees.enabled) return { content: [{ type: "text", text: "❌ Worktrees are disabled in .autogoal/config.json" }], details: {} };
      const prev = readState(ctx.cwd);
      const mode = normalizeMode(params.mode, prev.mode);
      ensureWorkspace(ctx.cwd, prev.title ?? "Untitled goal", "", mode);
      try {
        const created = createWorktree(ctx.cwd, mode, String(params.name));
        const state = writeState(ctx.cwd, { mode, worktreePath: created.path, branch: created.branch, repository: ctx.cwd });
        appendEvent(autogoalPaths(ctx.cwd).events, "worktree", { mode, ...created });
        return { content: [{ type: "text", text: `✅ Worktree ready: ${created.path} (${created.branch})` }], details: { state, worktree: created } };
      } catch (error) {
        return { content: [{ type: "text", text: `❌ Failed to create worktree: ${error instanceof Error ? error.message : String(error)}` }], details: {} };
      }
    },
  });

  registerGatedTool({
    name: "set_goal_state",
    label: "Set Goal State",
    description: "Patch .autogoal/state.json for mode/status, auto mode, title, metric, repository, branch, worktree, and human gate.",
    parameters: objectSchema({
      mode: stringProp("research, development, or optimization"),
      status: stringProp("idle, running, paused, or stopped"),
      auto: boolProp("Whether autonomous self-resume is enabled"),
      requiresHuman: boolProp("Whether user input is required before continuing"),
      title: stringProp("Goal title"),
      metric: stringProp("Optimization metric"),
      repository: stringProp("Repository path or URL"),
      branch: stringProp("Current branch"),
      worktreePath: stringProp("Current worktree path"),
      cycleIndex: numberProp("Current cycle index"),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const prev = readState(ctx.cwd);
      const mode = normalizeMode(params.mode, prev.mode);
      ensureWorkspace(ctx.cwd, prev.title ?? "Untitled goal", "", mode);
      const patch: Record<string, unknown> = {};
      for (const key of ["status", "mode", "auto", "requiresHuman", "title", "metric", "repository", "branch", "worktreePath", "cycleIndex"] as const) {
        if (params[key] !== undefined) patch[key] = params[key];
      }
      if (typeof patch.mode === "string") patch.mode = normalizeMode(patch.mode, prev.mode);
      if (typeof patch.status === "string" && !["idle", "running", "paused", "stopped"].includes(patch.status)) {
        return { content: [{ type: "text", text: `❌ Invalid status: ${patch.status}` }], details: {} };
      }
      const state = writeState(ctx.cwd, patch);
      setAutogoalTools(ctx, state.status === "running" || state.status === "paused");
      return { content: [{ type: "text", text: `✅ State updated: ${state.mode}/${state.status}, auto=${state.auto}, cycle=${state.cycleIndex}` }], details: { state } };
    },
  });

  registerGatedTool({
    name: "log_goal_cycle",
    label: "Log Goal Cycle",
    description: "Persist a completed Autogoal cycle, update next-cycle prompt, and advance state.",
    promptSnippet: "Persist a completed Autogoal cycle and advance state",
    promptGuidelines: [
      "Keep log_goal_cycle fields concise; large artifacts belong in `.autogoal/artifacts/` or living markdown files.",
      "For long next-cycle prompts, write `.autogoal/self-prompts/next-cycle.md` first and call log_goal_cycle with `nextPromptFile` instead of a huge inline `nextPrompt`.",
      "If a prompt or report contains a `[truncated]` marker, do not log the cycle; rewrite the full artifact first.",
      "In development mode, normal durable progress should be git commits; use this tool only for concise state advancement and next-cycle prompt refresh.",
    ],
    parameters: objectSchema({
      title: stringProp("Cycle title"),
      summary: stringProp("What was done"),
      findings: stringProp("Main findings"),
      interesting: stringProp("Interesting observations"),
      checks: stringProp("Validation/review/checks performed"),
      nextPrompt: stringProp("Concise self-prompt for the next cycle. Prefer nextPromptFile for long prompts."),
      nextPromptFile: stringProp("Path under .autogoal/ containing the full next-cycle prompt, e.g. .autogoal/self-prompts/next-cycle.md"),
      artifacts: stringProp("Optional newline-separated artifact paths written for this cycle"),
      requiresHuman: boolProp("Set true if continuing needs user input"),
      progress: boolProp("Whether this cycle made meaningful progress"),
    }, ["title", "summary"]),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const prev = readState(ctx.cwd);
      ensureWorkspace(ctx.cwd, prev.title ?? "Untitled goal", "", prev.mode);
      const p = autogoalPaths(ctx.cwd);
      const nextIndex = prev.cycleIndex + 1;
      const nextPrompt = readNextPromptInput(ctx.cwd, params as Record<string, unknown>);
      if (!nextPrompt.ok) {
        return { content: [{ type: "text", text: `❌ ${nextPrompt.error}` }], details: {} };
      }
      const cycleParams = { ...params, nextPrompt: nextPrompt.text, nextPromptFile: nextPrompt.file } as Record<string, unknown>;
      fs.writeFileSync(path.join(p.cyclesDir, cycleFileName(nextIndex)), markdownCycle(cycleParams, nextIndex));
      fs.writeFileSync(p.nextCycle, nextPrompt.text + "\n");
      appendEvent(p.events, "cycle", { cycleIndex: nextIndex, mode: prev.mode, title: params.title, progress: params.progress !== false });
      const config = readConfig(ctx.cwd);
      const requiresHuman = params.requiresHuman === true;
      const limitReached = nextIndex >= config.maxCycles;
      const state = writeState(ctx.cwd, {
        cycleIndex: nextIndex,
        requiresHuman,
        status: requiresHuman || limitReached ? "paused" : "running",
        auto: prev.auto && !(requiresHuman || limitReached),
      });
      const after = await runAutogoalHook(ctx.cwd, "after-cycle", { state, cycle: cycleParams });
      logHook(ctx.cwd, "after-cycle", after);
      const message = hookMessage("after-cycle", after);
      if (message) pi.sendUserMessage(message, { deliverAs: "steer" });
      setAutogoalTools(ctx, state.status === "running" || state.status === "paused");
      return { content: [{ type: "text", text: `✅ Cycle ${nextIndex} logged. status=${state.status}, auto=${state.auto}` }], details: { state } };
    },
  });

  pi.registerCommand("autogoal", {
    description: "Manage autonomous goal loops for research, development, and optimization",
    handler: async (args, ctx) => {
      const trimmed = (args ?? "").trim();
      if (!trimmed) {
        ctx.ui.notify(help(), "info");
        return;
      }

      const [commandRaw, ...rest] = trimmed.split(/\s+/);
      const command = commandRaw.toLowerCase();
      const payload = rest.join(" ").trim();

      const startMode = async (mode: AutogoalMode, goal: string): Promise<void> => {
        const title = inferTitle(goal || `Untitled ${mode} goal`);
        ensureWorkspace(ctx.cwd, title, goal, mode, mode === "optimization" ? goal : "");
        writeState(ctx.cwd, {
          mode,
          title,
          metric: mode === "optimization" ? goal || null : readState(ctx.cwd).metric,
          repository: ctx.cwd,
          branch: currentBranch(ctx.cwd),
          status: "running",
          auto: true,
          autoTurnsSent: 0,
          requiresHuman: false,
          lastPromptAt: new Date().toISOString(),
        });
        setAutogoalTools(ctx, true);
        appendEvent(autogoalPaths(ctx.cwd).events, "start", { mode, title });
        ctx.ui.notify(`Autogoal ${mode} mode running in ${AUTOGOAL_DIR}/`, "info");
        await fireBeforeHook(ctx, `start-${mode}`);
        markCyclePromptSent(ctx);
        sendWhenReady(pi, ctx, composeStartMessage(goal, mode));
      };

      if (command === "init") {
        const parsed = parseModePayload(payload, "research");
        const title = parsed.payload || `Untitled ${parsed.mode} goal`;
        ensureWorkspace(ctx.cwd, title, "", parsed.mode);
        writeState(ctx.cwd, { mode: parsed.mode, title, repository: ctx.cwd, branch: currentBranch(ctx.cwd), status: "idle", auto: false, requiresHuman: false });
        setAutogoalTools(ctx, true);
        appendEvent(autogoalPaths(ctx.cwd).events, "init", { mode: parsed.mode, title });
        ctx.ui.notify(`Autogoal ${parsed.mode} workspace initialized in ${AUTOGOAL_DIR}/`, "info");
        return;
      }

      if (command === "start") {
        const parsed = parseModePayload(payload, "research");
        await startMode(parsed.mode, parsed.payload);
        return;
      }

      if (["research", "res"].includes(command)) {
        await startMode("research", payload);
        return;
      }

      if (["dev", "development", "code"].includes(command)) {
        await startMode("development", payload);
        return;
      }

      if (["opt", "optimize", "optimization"].includes(command)) {
        await startMode("optimization", payload);
        return;
      }

      if (command === "cycle") {
        const prev = readState(ctx.cwd);
        ensureWorkspace(ctx.cwd, payload || prev.title || "Untitled goal", "", prev.mode);
        writeState(ctx.cwd, { status: "running", auto: false, requiresHuman: false, repository: ctx.cwd, branch: currentBranch(ctx.cwd) });
        setAutogoalTools(ctx, true);
        await fireBeforeHook(ctx, "manual-cycle");
        markCyclePromptSent(ctx);
        sendWhenReady(pi, ctx, composeCycleMessage(payload || "manual-cycle", readState(ctx.cwd).mode));
        return;
      }

      if (command === "pause") {
        clearTimer(ctx);
        writeState(ctx.cwd, { status: "paused", auto: false });
        setAutogoalTools(ctx, true);
        ctx.ui.notify("Autogoal paused", "info");
        return;
      }

      if (command === "resume") {
        const prev = readState(ctx.cwd);
        ensureWorkspace(ctx.cwd, payload || prev.title || "Untitled goal", "", prev.mode);
        writeState(ctx.cwd, { status: "running", auto: true, requiresHuman: false });
        setAutogoalTools(ctx, true);
        ctx.ui.notify("Autogoal resumed", "info");
        await fireBeforeHook(ctx, "resume");
        markCyclePromptSent(ctx);
        sendWhenReady(pi, ctx, composeCycleMessage("resume", readState(ctx.cwd).mode));
        return;
      }

      if (command === "off" || command === "stop") {
        clearTimer(ctx);
        if (workspaceExists(ctx.cwd)) writeState(ctx.cwd, { status: "stopped", auto: false });
        setAutogoalTools(ctx, false);
        ctx.ui.notify("Autogoal stopped", "info");
        return;
      }

      if (command === "status") {
        if (!workspaceExists(ctx.cwd)) {
          ctx.ui.notify("No .autogoal workspace in this directory", "warning");
          return;
        }
        ctx.ui.notify(statusText(ctx), "info");
        return;
      }

      ctx.ui.notify(help(), "warning");
    },
  });
}
