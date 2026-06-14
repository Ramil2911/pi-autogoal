import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import autogoalExtension from "../extensions/autogoal/index.ts";
import { readState, autogoalPaths } from "../extensions/autogoal/workspace.ts";

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "autogoal-ext-test-"));
}

function makeHarness() {
  const commands = new Map();
  const sent = [];
  const activeTools = new Set();
  const pi = {
    registerCommand(name, spec) {
      commands.set(name, spec);
    },
    registerTool() {},
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
  return { command: commands.get("autogoal"), sent };
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
  assert.match(fs.readFileSync(paths.goal, "utf-8"), /Add search filters/);
  assert.match(fs.readFileSync(paths.modeGuide, "utf-8"), /Development Mode/);
  assert.equal(sent.length, 1);
  assert.match(sent[0].message, /first autonomous development cycle now/);
  assert.doesNotMatch(sent[0].message, /^\/skill:/);
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
