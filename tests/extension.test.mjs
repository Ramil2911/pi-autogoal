import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import autogoalExtension from "../extensions/autogoal/index.ts";
import { readState, autogoalPaths, runAutogoalPaths } from "../extensions/autogoal/workspace.ts";

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "autogoal-ext-test-"));
}

function makeHarness() {
  const commands = new Map();
  const tools = new Map();
  const sent = [];
  const activeTools = new Set();
  const pi = {
    registerCommand(name, spec) {
      commands.set(name, spec);
    },
    registerTool(spec) {
      tools.set(spec.name, spec);
    },
    on() {},
    getActiveTools() {
      return [...activeTools];
    },
    setActiveTools(names) {
      activeTools.clear();
      for (const name of names) activeTools.add(name);
    },
    sendUserMessage(message, options) {
      sent.push({ message, options });
    },
  };
  autogoalExtension(pi);
  return { command: commands.get("autogoal"), tools, sent };
}

function makeCtx(cwd) {
  const notifications = [];
  const statuses = [];
  return {
    cwd,
    sessionManager: {
      getSessionId: () => `test-${cwd}`,
    },
    isIdle: () => true,
    ui: {
      notify(message, level) {
        notifications.push({ message, level });
      },
      setStatus(name, value) {
        statuses.push({ name, value });
      },
    },
    notifications,
    statuses,
  };
}

test("/autogoal init creates generic workspace scaffolding", async () => {
  const dir = tmpdir();
  const { command, sent } = makeHarness();
  const ctx = makeCtx(dir);

  await command.handler("init", ctx);

  const paths = autogoalPaths(dir);
  assert.equal(fs.existsSync(paths.root), true);
  assert.match(fs.readFileSync(paths.goal, "utf-8"), /No active Autogoal goal/);
  assert.equal(readState(dir).status, "idle");
  assert.equal(readState(dir).auto, false);
  assert.equal(sent.length, 0);
});

test("/autogoal start dev sends explicit development first-cycle prompt", async () => {
  const dir = tmpdir();
  const { command, sent } = makeHarness();
  const ctx = makeCtx(dir);

  await command.handler("init", ctx);
  await command.handler("start dev Add search filters", ctx);

  const paths = autogoalPaths(dir);
  const state = readState(dir);
  assert.equal(state.status, "running");
  assert.equal(state.auto, true);
  assert.equal(state.mode, "development");
  assert.ok(state.runId);
  assert.match(fs.readFileSync(paths.goal, "utf-8"), /Add search filters/);
  assert.match(fs.readFileSync(paths.modeGuide, "utf-8"), /Development Mode/);
  assert.match(fs.readFileSync(runAutogoalPaths(dir, state.runId).goal, "utf-8"), /Add search filters/);
  assert.equal(sent.length, 1);
  assert.match(sent[0].message, /first autonomous development cycle now/);
  assert.match(sent[0].message, new RegExp(`\\.autogoal/runs/${state.runId}/artifacts/`));
  assert.doesNotMatch(sent[0].message, /^\/skill:/);
});

test("/autogoal start --run keeps previous run artifacts by allocating unique run dirs", async () => {
  const dir = tmpdir();
  const { command } = makeHarness();
  const ctx = makeCtx(dir);

  await command.handler("start --run feature dev First goal", ctx);
  const first = readState(dir).runId;
  assert.equal(first, "feature");
  const firstRun = runAutogoalPaths(dir, first);
  fs.writeFileSync(path.join(firstRun.artifactsDir, "note.txt"), "first artifact");

  await command.handler("start --run feature dev Second goal", ctx);
  const second = readState(dir).runId;
  assert.equal(second, "feature-2");
  assert.equal(fs.readFileSync(path.join(firstRun.artifactsDir, "note.txt"), "utf-8"), "first artifact");
  assert.match(fs.readFileSync(runAutogoalPaths(dir, second).goal, "utf-8"), /Second goal/);
});

test("log_goal_cycle mirrors cycle artifacts into the active run", async () => {
  const dir = tmpdir();
  const { command, tools } = makeHarness();
  const ctx = makeCtx(dir);

  await command.handler("start --run research-a research Compare designs", ctx);
  const tool = tools.get("log_goal_cycle");
  const result = await tool.execute("cycle", { title: "Cycle 1", summary: "Did work", nextPrompt: "Continue" }, undefined, undefined, ctx);

  assert.match(result.content[0].text, /Cycle 1 logged/);
  assert.equal(fs.existsSync(path.join(autogoalPaths(dir).cyclesDir, "cycle-001.md")), true);
  assert.equal(fs.existsSync(path.join(runAutogoalPaths(dir, "research-a").cyclesDir, "cycle-001.md")), true);
  assert.match(fs.readFileSync(runAutogoalPaths(dir, "research-a").nextCycle, "utf-8"), /Continue/);
});

test("/autogoal start requires a goal", async () => {
  const dir = tmpdir();
  const { command, sent } = makeHarness();
  const ctx = makeCtx(dir);

  await command.handler("start dev", ctx);

  assert.equal(fs.existsSync(autogoalPaths(dir).root), false);
  assert.equal(sent.length, 0);
  assert.equal(ctx.notifications.at(-1).level, "warning");
});
