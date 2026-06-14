import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { appendEvent, type JsonRecord } from "./jsonl.ts";
import { autogoalPaths } from "./workspace.ts";

export type HookName = "before-cycle" | "after-cycle";

export interface HookResult {
  fired: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
}

const TIMEOUT_MS = 30_000;
const STDOUT_MAX = 8 * 1024;

function hookPath(cwd: string, name: HookName): string {
  return path.join(autogoalPaths(cwd).root, "hooks", `${name}.sh`);
}

function executable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

export async function runAutogoalHook(cwd: string, name: HookName, payload: JsonRecord): Promise<HookResult> {
  const script = hookPath(cwd, name);
  if (!executable(script)) return { fired: false, stdout: "", stderr: "", exitCode: null, timedOut: false, durationMs: 0 };
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn("bash", [script], { cwd, timeout: TIMEOUT_MS });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(stdout) >= STDOUT_MAX) return;
      stdout += chunk.toString("utf-8");
      if (Buffer.byteLength(stdout) > STDOUT_MAX) stdout = stdout.slice(0, STDOUT_MAX) + "\n…[truncated]";
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf-8"); });
    child.on("error", (error) => {
      resolve({ fired: true, stdout, stderr: stderr + error.message, exitCode: null, timedOut: false, durationMs: Date.now() - started });
    });
    child.on("close", (code) => {
      resolve({ fired: true, stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code, timedOut: child.killed, durationMs: Date.now() - started });
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

export function hookMessage(name: HookName, result: HookResult): string | null {
  if (!result.fired) return null;
  if (result.timedOut) return `[autogoal ${name} hook timed out]`;
  if (result.exitCode !== 0) return [`[autogoal ${name} hook failed: ${result.exitCode}]`, result.stderr, result.stdout].filter(Boolean).join("\n");
  return result.stdout.trim() || null;
}

export function logHook(cwd: string, name: HookName, result: HookResult): void {
  if (!result.fired) return;
  appendEvent(autogoalPaths(cwd).events, "hook", {
    hook: name,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    stdoutBytes: Buffer.byteLength(result.stdout, "utf-8"),
  });
}

