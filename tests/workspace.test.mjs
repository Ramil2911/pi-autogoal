import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  appendJsonl,
  countJsonl,
  tailJsonl,
} from "../extensions/autogoal/jsonl.ts";
import { buildAutogoalCompactionSummary } from "../extensions/autogoal/compaction.ts";
import {
  composeCycleMessage,
  ensureWorkspace,
  inferTitle,
  autogoalPaths,
  readConfig,
  readState,
  writeState,
  workspaceExists,
} from "../extensions/autogoal/workspace.ts";

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "autogoal-test-"));
}

test("ensureWorkspace creates the required layout without overwriting state", () => {
  const dir = tmpdir();
  assert.equal(workspaceExists(dir), false);
  const paths = ensureWorkspace(dir, "Test Research", "Initial abstract");
  assert.equal(workspaceExists(dir), true);
  for (const p of [paths.config, paths.state, paths.goal, paths.plan, paths.backlog, paths.questions, paths.leads, paths.modeGuide, paths.subagentsGuide, paths.sources, paths.findings, paths.metrics, paths.events, paths.nextCycle]) {
    assert.equal(fs.existsSync(p), true, p);
  }
  assert.match(fs.readFileSync(paths.goal, "utf-8"), /Initial abstract/);
  writeState(dir, { status: "running", cycleIndex: 7 });
  ensureWorkspace(dir, "Other", "Other abstract");
  assert.equal(readState(dir).cycleIndex, 7);
});

test("readConfig and readState apply defaults and preserve valid values", () => {
  const dir = tmpdir();
  const paths = ensureWorkspace(dir);
  fs.writeFileSync(paths.config, JSON.stringify({ maxAutoTurns: 3, autonomy: "supervised" }));
  fs.writeFileSync(paths.state, JSON.stringify({ status: "paused", auto: true, title: "X", requiresHuman: true }));
  const config = readConfig(dir);
  const state = readState(dir);
  assert.equal(config.maxAutoTurns, 3);
  assert.equal(config.autonomy, "supervised");
  assert.equal(config.worktrees.enabled, true);
  assert.equal(config.worktrees.root, "../.autogoal-worktrees");
  assert.equal(config.subagents.enabled, true);
  assert.equal(config.subagents.useAcceptance, true);
  assert.match(config.subagents.timeoutPolicy, /no-timeout/);
  assert.equal(typeof config.maxCycles, "number");
  assert.equal(typeof config.reviewEveryCycles, "number");
  assert.equal(typeof config.settleMs, "number");
  assert.equal(state.status, "paused");
  assert.equal(state.mode, "research");
  assert.equal(state.auto, true);
  assert.equal(state.title, "X");
  assert.equal(state.requiresHuman, true);
});

test("inferTitle and composeCycleMessage are stable", () => {
  assert.equal(inferTitle(""), "Untitled goal");
  assert.ok(inferTitle("a".repeat(100)).length <= 72);
  assert.match(composeCycleMessage("test", "development"), /Autogoal test/);
  assert.match(composeCycleMessage("test", "development"), /development cycle/);
  assert.match(composeCycleMessage("test"), /\.autogoal\//);
});

test("ensureWorkspace creates mode-specific development and optimization guides", () => {
  const devDir = tmpdir();
  const dev = ensureWorkspace(devDir, "Build feature", "Implement feature", "development");
  assert.equal(readState(devDir).mode, "development");
  assert.match(fs.readFileSync(dev.modeGuide, "utf-8"), /git commits/);
  assert.match(fs.readFileSync(dev.nextCycle, "utf-8"), /development loop/);

  const optDir = tmpdir();
  const opt = ensureWorkspace(optDir, "Speed up tests", "Improve test runtime", "optimization", "test runtime p95");
  assert.equal(readState(optDir).mode, "optimization");
  assert.equal(readState(optDir).metric, "test runtime p95");
  assert.match(fs.readFileSync(opt.goal, "utf-8"), /test runtime p95/);
  assert.match(fs.readFileSync(opt.nextCycle, "utf-8"), /optimization loop/);
});

test("jsonl helpers append, count, and tail records", () => {
  const dir = tmpdir();
  const paths = ensureWorkspace(dir);
  appendJsonl(paths.findings, { type: "finding", claim: "A" });
  appendJsonl(paths.findings, { type: "finding", claim: "B" });
  assert.equal(countJsonl(paths.findings), 2);
  assert.deepEqual(tailJsonl(paths.findings, 1).map((x) => x.claim), ["B"]);
});

test("compaction summary is built from persisted workspace files", () => {
  const dir = tmpdir();
  const paths = ensureWorkspace(dir, "Compaction Test", "Baseline abstract");
  fs.writeFileSync(path.join(paths.cyclesDir, "cycle-001.md"), "# Cycle 1\n\nFinding X");
  fs.appendFileSync(paths.leads, "\n- Lead A\n");
  appendJsonl(paths.sources, { type: "source", title: "Source A" });
  appendJsonl(paths.findings, { type: "finding", claim: "Claim A" });
  appendJsonl(paths.metrics, { type: "metric", name: "Latency", value: "10ms" });
  const summary = buildAutogoalCompactionSummary(dir);
  assert.match(summary, /Autogoal Compaction Summary/);
  assert.match(summary, /Compaction Test/);
  assert.match(summary, /Finding X/);
  assert.match(summary, /Source A/);
  assert.match(summary, /Claim A/);
  assert.match(summary, /Lead A/);
  assert.match(summary, /Latency/);
});

test("compaction keeps reading legacy evidence and interesting files", () => {
  const dir = tmpdir();
  const paths = ensureWorkspace(dir, "Legacy Test", "Baseline abstract");
  appendJsonl(paths.legacyEvidence, { type: "evidence", claim: "Legacy Claim" });
  fs.writeFileSync(paths.legacyInteresting, "# Interesting\n\n- Legacy Lead\n");
  const summary = buildAutogoalCompactionSummary(dir);
  assert.match(summary, /Legacy Claim/);
  assert.match(summary, /Legacy Lead/);
});
