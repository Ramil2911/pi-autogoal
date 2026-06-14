import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  assistantLimitExhaustionReason,
  containsTruncationMarker,
  limitExhaustionReason,
} from "../extensions/autogoal/safety.ts";
import { readNextPromptInput } from "../extensions/autogoal/index.ts";
import { ensureWorkspace } from "../extensions/autogoal/workspace.ts";

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "autogoal-safety-test-"));
}

test("limitExhaustionReason recognizes quota and token/context failures", () => {
  assert.equal(limitExhaustionReason("OpenAI API error (429): insufficient_quota"), "provider quota exhausted");
  assert.equal(limitExhaustionReason("maximum context length is 128000 tokens"), "context window exhausted");
  assert.equal(limitExhaustionReason("input is too long and exceeds the model limit"), "prompt/input token limit exceeded");
  assert.equal(limitExhaustionReason("ordinary validation error"), null);
});

test("assistantLimitExhaustionReason inspects assistant error messages", () => {
  const message = {
    role: "assistant",
    stopReason: "error",
    errorMessage: "Resource exhausted: quota exceeded for token budget",
    content: [],
  };
  assert.equal(assistantLimitExhaustionReason(message), "provider quota exhausted");
  assert.equal(assistantLimitExhaustionReason({ role: "user", content: "quota exceeded" }), null);
});

test("containsTruncationMarker detects common tool/output truncation markers", () => {
  assert.equal(containsTruncationMarker("full output\n…[truncated]"), true);
  assert.equal(containsTruncationMarker("[Truncated: showing 10 of 200 lines]"), true);
  assert.equal(containsTruncationMarker("complete next prompt"), false);
});

test("readNextPromptInput accepts regular files inside .autogoal", () => {
  const dir = tmpdir();
  const paths = ensureWorkspace(dir);
  fs.writeFileSync(paths.nextCycle, "Continue with full prompt\n");

  assert.deepEqual(
    readNextPromptInput(dir, { nextPromptFile: ".autogoal/self-prompts/next-cycle.md" }),
    { ok: true, text: "Continue with full prompt", file: ".autogoal/self-prompts/next-cycle.md" },
  );
});

test("readNextPromptInput rejects symlinks and paths outside .autogoal", () => {
  const dir = tmpdir();
  const paths = ensureWorkspace(dir);
  const external = path.join(dir, "external-next.md");
  fs.writeFileSync(external, "external prompt\n");

  const symlink = path.join(paths.selfPromptsDir, "external-link.md");
  fs.symlinkSync(external, symlink);

  const linkResult = readNextPromptInput(dir, { nextPromptFile: ".autogoal/self-prompts/external-link.md" });
  assert.equal(linkResult.ok, false);
  assert.match(linkResult.error, /symbolic link/);

  const outsideResult = readNextPromptInput(dir, { nextPromptFile: "external-next.md" });
  assert.equal(outsideResult.ok, false);
  assert.match(outsideResult.error, /inside \.autogoal/);

  const directoryResult = readNextPromptInput(dir, { nextPromptFile: ".autogoal/self-prompts" });
  assert.equal(directoryResult.ok, false);
  assert.match(directoryResult.error, /regular file/);
});
