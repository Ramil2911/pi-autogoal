import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  appendJsonl,
  countJsonl,
  tailJsonl,
} from "../extensions/autoscope/jsonl.ts";
import { buildAutoscopeCompactionSummary } from "../extensions/autoscope/compaction.ts";
import {
  composeCycleMessage,
  ensureWorkspace,
  inferTitle,
  autoscopePaths,
  readConfig,
  readState,
  writeState,
  workspaceExists,
} from "../extensions/autoscope/workspace.ts";

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "autoscope-test-"));
}

test("ensureWorkspace creates the required layout without overwriting state", () => {
  const dir = tmpdir();
  assert.equal(workspaceExists(dir), false);
  const paths = ensureWorkspace(dir, "Test Research", "Initial abstract");
  assert.equal(workspaceExists(dir), true);
  for (const p of [paths.config, paths.state, paths.goal, paths.plan, paths.backlog, paths.questions, paths.interesting, paths.sources, paths.evidence, paths.events, paths.nextCycle]) {
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
  assert.equal(typeof config.maxCycles, "number");
  assert.equal(typeof config.reviewEveryCycles, "number");
  assert.equal(typeof config.settleMs, "number");
  assert.equal(state.status, "paused");
  assert.equal(state.auto, true);
  assert.equal(state.title, "X");
  assert.equal(state.requiresHuman, true);
});

test("inferTitle and composeCycleMessage are stable", () => {
  assert.equal(inferTitle(""), "Untitled research");
  assert.ok(inferTitle("a".repeat(100)).length <= 72);
  assert.match(composeCycleMessage("test"), /Autoscope test/);
  assert.match(composeCycleMessage("test"), /\.autoscope\//);
});

test("jsonl helpers append, count, and tail records", () => {
  const dir = tmpdir();
  const paths = ensureWorkspace(dir);
  appendJsonl(paths.evidence, { type: "evidence", claim: "A" });
  appendJsonl(paths.evidence, { type: "evidence", claim: "B" });
  assert.equal(countJsonl(paths.evidence), 2);
  assert.deepEqual(tailJsonl(paths.evidence, 1).map((x) => x.claim), ["B"]);
});

test("compaction summary is built from persisted workspace files", () => {
  const dir = tmpdir();
  const paths = ensureWorkspace(dir, "Compaction Test", "Baseline abstract");
  fs.writeFileSync(path.join(paths.cyclesDir, "cycle-001.md"), "# Cycle 1\n\nFinding X");
  appendJsonl(paths.sources, { type: "source", title: "Source A" });
  appendJsonl(paths.evidence, { type: "evidence", claim: "Claim A" });
  const summary = buildAutoscopeCompactionSummary(dir);
  assert.match(summary, /Autoscope Compaction Summary/);
  assert.match(summary, /Compaction Test/);
  assert.match(summary, /Finding X/);
  assert.match(summary, /Source A/);
  assert.match(summary, /Claim A/);
});
