import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildAutoscopeCompactionSummary } from "./compaction.ts";
import { appendEvent, appendJsonl, countJsonl, tailJsonl } from "./jsonl.ts";
import { hookMessage, logHook, runAutoscopeHook } from "./hooks.ts";
import { assistantLimitExhaustionReason, containsTruncationMarker } from "./safety.ts";
import {
  composeCycleMessage,
  composeStartMessage,
  ensureWorkspace,
  inferTitle,
  AUTOSCOPE_DIR,
  autoscopePaths,
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
    "Autoscope commands:",
    "  /autoscope init [title]       create .autoscope workspace",
    "  /autoscope start <abstract>   start autonomous research",
    "  /autoscope cycle [focus]      run one next-cycle prompt",
    "  /autoscope pause              pause auto-resume",
    "  /autoscope resume             resume auto-resume",
    "  /autoscope off                stop auto-resume",
    "  /autoscope status             show state",
  ].join("\n");
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

export function resolveAutoscopeFile(cwd: string, candidate: string): { ok: true; path: string } | { ok: false; error: string } {
  const root = autoscopePaths(cwd).root;
  const resolved = path.resolve(cwd, candidate);
  let rootReal: string;
  let stat: fs.Stats;
  let fileReal: string;

  try {
    rootReal = fs.realpathSync(root);
  } catch (error) {
    return { ok: false, error: `${AUTOSCOPE_DIR}/ is not accessible: ${error instanceof Error ? error.message : String(error)}` };
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
    return { ok: false, error: `nextPromptFile must point inside ${AUTOSCOPE_DIR}/` };
  }

  return { ok: true, path: fileReal };
}

export function readNextPromptInput(cwd: string, params: Record<string, unknown>): { ok: true; text: string; file?: string } | { ok: false; error: string } {
  const p = autoscopePaths(cwd);
  const fileParam = typeof params.nextPromptFile === "string" ? params.nextPromptFile.trim() : "";
  if (fileParam) {
    const resolved = resolveAutoscopeFile(cwd, fileParam);
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
    if (containsTruncationMarker(inline)) return { ok: false, error: "nextPrompt appears to contain a truncation marker; write the full prompt to .autoscope/self-prompts/next-cycle.md and call log_research_cycle with nextPromptFile instead" };
    return { ok: true, text: inline };
  }

  return { ok: false, error: `Provide nextPrompt or nextPromptFile (for example ${path.relative(cwd, p.nextCycle)})` };
}

function statusText(ctx: ExtensionContext): string {
  const state = readState(ctx.cwd);
  const config = readConfig(ctx.cwd);
  const p = autoscopePaths(ctx.cwd);
  return `Autoscope ${state.status} · cycle ${state.cycleIndex}/${config.maxCycles} · auto ${state.autoTurnsSent}/${config.maxAutoTurns} · sources ${countJsonl(p.sources)} · evidence ${countJsonl(p.evidence)} · human=${state.requiresHuman}`;
}

function setAutoscopeStatus(ctx: ExtensionContext): void {
  if (!workspaceExists(ctx.cwd)) {
    ctx.ui.setStatus?.("autoscope", undefined);
    return;
  }
  ctx.ui.setStatus?.("autoscope", statusText(ctx));
}

export default function autoscopeExtension(pi: ExtensionAPI) {
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

  const setAutoscopeTools = (ctx: ExtensionContext, enabled: boolean): void => {
    const active = new Set(pi.getActiveTools());
    for (const name of gatedToolNames) enabled ? active.add(name) : active.delete(name);
    pi.setActiveTools([...active]);
    setAutoscopeStatus(ctx);
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
    appendEvent(autoscopePaths(ctx.cwd).events, "limit-exhausted", {
      reason,
      contextTokens: usage?.tokens ?? null,
      contextWindow: usage?.contextWindow ?? null,
      contextPercent: usage?.percent ?? null,
    });
    setAutoscopeTools(ctx, true);
    ctx.ui.notify(`Autoscope paused: ${reason}. Fix the token/quota issue, then /autoscope resume.`, "warning");
  };

  const fireBeforeHook = async (ctx: ExtensionContext, reason: string): Promise<void> => {
    const result = await runAutoscopeHook(ctx.cwd, "before-cycle", { reason, state: readState(ctx.cwd), recentEvidence: tailJsonl(autoscopePaths(ctx.cwd).evidence, 5) });
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
      setAutoscopeTools(ctx, false);
      ctx.ui.notify("Autoscope paused: state.requiresHuman=true", "warning");
      return;
    }
    if (state.autoTurnsSent >= config.maxAutoTurns || state.cycleIndex >= config.maxCycles) {
      writeState(ctx.cwd, { status: "paused", auto: false });
      setAutoscopeTools(ctx, false);
      ctx.ui.notify("Autoscope paused: configured auto/cycle limit reached", "info");
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
      pi.sendUserMessage(composeCycleMessage(reason));
    }, config.settleMs);
  };

  pi.on("session_start", async (_event, ctx) => {
    const active = workspaceExists(ctx.cwd) && ["running", "paused"].includes(readState(ctx.cwd).status);
    runtimeFor(ctx).lastPromptedCycleIndex = workspaceExists(ctx.cwd) ? readState(ctx.cwd).cycleIndex : -1;
    setAutoscopeTools(ctx, active);
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
        summary: buildAutoscopeCompactionSummary(ctx.cwd),
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
      },
    };
  });

  pi.on("session_compact", async (_event, ctx) => {
    scheduleNext(ctx, "compaction");
  });

  pi.on("agent_end", async (event, ctx) => {
    setAutoscopeStatus(ctx);
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
    const paths = autoscopePaths(ctx.cwd);
    const extra = [
      "",
      "## Autoscope Research Mode",
      `Workspace state lives in \`${AUTOSCOPE_DIR}/\`. Treat these files as the source of truth, not the chat history.`,
      `Read/update: \`${paths.goal}\`, \`${paths.plan}\`, \`${paths.backlog}\`, \`${paths.interesting}\`, cycle reports, and \`${paths.nextCycle}\`.`,
      "Use Autoscope tools when available: log_source, log_evidence, log_interesting, log_research_cycle, set_research_state.",
      "Avoid passing large artifact bodies through function-call arguments. Write large reports/prompts directly under `.autoscope/` first, then pass file paths (for example nextPromptFile) to Autoscope tools.",
      "Maintain an evolving goal, automatically updated plan, evidence log, interesting observations, and next-cycle self-prompt.",
      "Autonomy is full for research work, but safety gates still apply for destructive actions, external side effects, secrets, publishing, deploys, payments, and data deletion.",
    ].join("\n");
    return { systemPrompt: `${event.systemPrompt}\n${extra}` };
  });

  registerGatedTool({
    name: "log_source",
    label: "Log Source",
    description: "Append a source record to .autoscope/sources.jsonl.",
    parameters: objectSchema({
      title: stringProp("Source title"),
      url: stringProp("URL or local path"),
      type: stringProp("paper, docs, web, local, dataset, code, etc."),
      quality: stringProp("Quality/reliability assessment"),
      notes: stringProp("Short notes"),
    }, ["title"]),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      ensureWorkspace(ctx.cwd, readState(ctx.cwd).title ?? "Untitled research");
      appendJsonl(autoscopePaths(ctx.cwd).sources, { type: "source", ...params });
      return { content: [{ type: "text", text: `✅ Source logged: ${params.title}` }], details: { params } };
    },
  });

  registerGatedTool({
    name: "log_evidence",
    label: "Log Evidence",
    description: "Append an evidence record to .autoscope/evidence.jsonl.",
    parameters: objectSchema({
      claim: stringProp("Claim, observation, or result"),
      support: stringProp("Evidence supporting or refuting the claim"),
      confidence: stringProp("low, medium, high, or unknown"),
      source: stringProp("Source id/url/path if available"),
      implications: stringProp("Why this matters for the research plan"),
    }, ["claim", "support"]),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      ensureWorkspace(ctx.cwd, readState(ctx.cwd).title ?? "Untitled research");
      appendJsonl(autoscopePaths(ctx.cwd).evidence, { type: "evidence", ...params });
      return { content: [{ type: "text", text: `✅ Evidence logged: ${String(params.claim).slice(0, 120)}` }], details: { params } };
    },
  });

  registerGatedTool({
    name: "log_interesting",
    label: "Log Interesting",
    description: "Record an interesting observation in .autoscope/interesting.md and events.jsonl.",
    parameters: objectSchema({
      observation: stringProp("Surprising observation, weak signal, anomaly, or side hypothesis"),
      why: stringProp("Why it may matter"),
      followup: stringProp("Possible follow-up"),
    }, ["observation"]),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      ensureWorkspace(ctx.cwd, readState(ctx.cwd).title ?? "Untitled research");
      const p = autoscopePaths(ctx.cwd);
      fs.appendFileSync(p.interesting, `\n- **${new Date().toISOString()}** ${params.observation}${params.why ? ` — ${params.why}` : ""}${params.followup ? ` (follow-up: ${params.followup})` : ""}\n`);
      appendEvent(p.events, "interesting", params as Record<string, unknown>);
      return { content: [{ type: "text", text: "✅ Interesting observation recorded" }], details: { params } };
    },
  });

  registerGatedTool({
    name: "set_research_state",
    label: "Set Research State",
    description: "Patch .autoscope/state.json for status, auto mode, title, and human gate.",
    parameters: objectSchema({
      status: stringProp("idle, running, paused, or stopped"),
      auto: boolProp("Whether autonomous self-resume is enabled"),
      requiresHuman: boolProp("Whether user input is required before continuing"),
      title: stringProp("Research title"),
      cycleIndex: numberProp("Current cycle index"),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      ensureWorkspace(ctx.cwd, readState(ctx.cwd).title ?? "Untitled research");
      const patch: Record<string, unknown> = {};
      for (const key of ["status", "auto", "requiresHuman", "title", "cycleIndex"] as const) {
        if (params[key] !== undefined) patch[key] = params[key];
      }
      if (typeof patch.status === "string" && !["idle", "running", "paused", "stopped"].includes(patch.status)) {
        return { content: [{ type: "text", text: `❌ Invalid status: ${patch.status}` }], details: {} };
      }
      const state = writeState(ctx.cwd, patch);
      setAutoscopeTools(ctx, state.status === "running" || state.status === "paused");
      return { content: [{ type: "text", text: `✅ State updated: ${state.status}, auto=${state.auto}, cycle=${state.cycleIndex}` }], details: { state } };
    },
  });

  registerGatedTool({
    name: "log_research_cycle",
    label: "Log Research Cycle",
    description: "Persist a completed research cycle, update next-cycle prompt, and advance state.",
    promptSnippet: "Persist a completed Autoscope cycle and advance state",
    promptGuidelines: [
      "Keep log_research_cycle fields concise; large artifacts belong in `.autoscope/artifacts/` or living markdown files.",
      "For long next-cycle prompts, write `.autoscope/self-prompts/next-cycle.md` first and call log_research_cycle with `nextPromptFile` instead of a huge inline `nextPrompt`.",
      "If a prompt or report contains a `[truncated]` marker, do not log the cycle; rewrite the full artifact first.",
    ],
    parameters: objectSchema({
      title: stringProp("Cycle title"),
      summary: stringProp("What was done"),
      findings: stringProp("Main findings"),
      interesting: stringProp("Interesting observations"),
      checks: stringProp("Validation/review/checks performed"),
      nextPrompt: stringProp("Concise self-prompt for the next cycle. Prefer nextPromptFile for long prompts."),
      nextPromptFile: stringProp("Path under .autoscope/ containing the full next-cycle prompt, e.g. .autoscope/self-prompts/next-cycle.md"),
      artifacts: stringProp("Optional newline-separated artifact paths written for this cycle"),
      requiresHuman: boolProp("Set true if continuing needs user input"),
      progress: boolProp("Whether this cycle made meaningful progress"),
    }, ["title", "summary"]),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      ensureWorkspace(ctx.cwd, readState(ctx.cwd).title ?? "Untitled research");
      const p = autoscopePaths(ctx.cwd);
      const prev = readState(ctx.cwd);
      const nextIndex = prev.cycleIndex + 1;
      const nextPrompt = readNextPromptInput(ctx.cwd, params as Record<string, unknown>);
      if (!nextPrompt.ok) {
        return { content: [{ type: "text", text: `❌ ${nextPrompt.error}` }], details: {} };
      }
      const cycleParams = { ...params, nextPrompt: nextPrompt.text, nextPromptFile: nextPrompt.file } as Record<string, unknown>;
      fs.writeFileSync(path.join(p.cyclesDir, cycleFileName(nextIndex)), markdownCycle(cycleParams, nextIndex));
      fs.writeFileSync(p.nextCycle, nextPrompt.text + "\n");
      appendEvent(p.events, "cycle", { cycleIndex: nextIndex, title: params.title, progress: params.progress !== false });
      const config = readConfig(ctx.cwd);
      const requiresHuman = params.requiresHuman === true;
      const limitReached = nextIndex >= config.maxCycles;
      const state = writeState(ctx.cwd, {
        cycleIndex: nextIndex,
        requiresHuman,
        status: requiresHuman || limitReached ? "paused" : "running",
        auto: prev.auto && !(requiresHuman || limitReached),
      });
      const after = await runAutoscopeHook(ctx.cwd, "after-cycle", { state, cycle: cycleParams });
      logHook(ctx.cwd, "after-cycle", after);
      const message = hookMessage("after-cycle", after);
      if (message) pi.sendUserMessage(message, { deliverAs: "steer" });
      setAutoscopeTools(ctx, state.status === "running" || state.status === "paused");
      return { content: [{ type: "text", text: `✅ Cycle ${nextIndex} logged. status=${state.status}, auto=${state.auto}` }], details: { state } };
    },
  });

  pi.registerCommand("autoscope", {
    description: "Manage autonomous long-horizon research mode",
    handler: async (args, ctx) => {
      const trimmed = (args ?? "").trim();
      if (!trimmed) {
        ctx.ui.notify(help(), "info");
        return;
      }

      const [commandRaw, ...rest] = trimmed.split(/\s+/);
      const command = commandRaw.toLowerCase();
      const payload = rest.join(" ").trim();

      if (command === "init") {
        const title = payload || "Untitled research";
        ensureWorkspace(ctx.cwd, title);
        writeState(ctx.cwd, { title, status: "idle", auto: false, requiresHuman: false });
        setAutoscopeTools(ctx, true);
        appendEvent(autoscopePaths(ctx.cwd).events, "init", { title });
        ctx.ui.notify(`Autoscope workspace initialized in ${AUTOSCOPE_DIR}/`, "info");
        return;
      }

      if (command === "start") {
        const abstract = payload;
        const title = inferTitle(abstract || "Untitled research");
        ensureWorkspace(ctx.cwd, title, abstract);
        writeState(ctx.cwd, {
          title,
          status: "running",
          auto: true,
          autoTurnsSent: 0,
          requiresHuman: false,
          lastPromptAt: new Date().toISOString(),
        });
        setAutoscopeTools(ctx, true);
        appendEvent(autoscopePaths(ctx.cwd).events, "start", { title });
        ctx.ui.notify(`Autoscope running in ${AUTOSCOPE_DIR}/`, "info");
        await fireBeforeHook(ctx, "start");
        markCyclePromptSent(ctx);
        sendWhenReady(pi, ctx, composeStartMessage(abstract));
        return;
      }

      if (command === "cycle") {
        ensureWorkspace(ctx.cwd, payload || "Untitled research");
        writeState(ctx.cwd, { status: "running", auto: false, requiresHuman: false });
        setAutoscopeTools(ctx, true);
        await fireBeforeHook(ctx, "manual-cycle");
        markCyclePromptSent(ctx);
        sendWhenReady(pi, ctx, composeCycleMessage(payload || "manual-cycle"));
        return;
      }

      if (command === "pause") {
        clearTimer(ctx);
        writeState(ctx.cwd, { status: "paused", auto: false });
        setAutoscopeTools(ctx, true);
        ctx.ui.notify("Autoscope paused", "info");
        return;
      }

      if (command === "resume") {
        ensureWorkspace(ctx.cwd, payload || "Untitled research");
        writeState(ctx.cwd, { status: "running", auto: true, requiresHuman: false });
        setAutoscopeTools(ctx, true);
        ctx.ui.notify("Autoscope resumed", "info");
        await fireBeforeHook(ctx, "resume");
        markCyclePromptSent(ctx);
        sendWhenReady(pi, ctx, composeCycleMessage("resume"));
        return;
      }

      if (command === "off" || command === "stop") {
        clearTimer(ctx);
        if (workspaceExists(ctx.cwd)) writeState(ctx.cwd, { status: "stopped", auto: false });
        setAutoscopeTools(ctx, false);
        ctx.ui.notify("Autoscope stopped", "info");
        return;
      }

      if (command === "status") {
        if (!workspaceExists(ctx.cwd)) {
          ctx.ui.notify("No .autoscope workspace in this directory", "warning");
          return;
        }
        ctx.ui.notify(statusText(ctx), "info");
        return;
      }

      ctx.ui.notify(help(), "warning");
    },
  });
}
