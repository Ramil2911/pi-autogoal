# pi-autoscope

Autonomous long-horizon research workflow for [pi](https://pi.dev/).

## What it provides

- `/autoscope` command implemented as a pi extension.
- `autoscope` skill with the full research-loop protocol.
- Prompt templates for manual start/cycle/eval/status.
- Workspace state in `.autoscope/`, so multiple research folders can run independently.
- Autonomous self-prompting via `agent_end -> sendUserMessage(next-cycle)`.
- Structured tools: `log_source`, `log_evidence`, `log_interesting`, `log_research_cycle`, `set_research_state`.
- Deterministic compaction summary from persisted `.autoscope/` state.
- Optional lifecycle hooks: `.autoscope/hooks/before-cycle.sh` and `.autoscope/hooks/after-cycle.sh`.

## Install locally

From this repository:

```bash
pi install /home/ramil/personal/autoresearcher
```

Or enable it only in one research workspace with `.pi/settings.json`:

```json
{
  "packages": ["/home/ramil/personal/autoresearcher"]
}
```

Then restart pi or run `/reload`.

## Commands

```text
/autoscope init [title]
/autoscope start <abstract or goal>
/autoscope cycle [focus]
/autoscope pause
/autoscope resume
/autoscope off
/autoscope status
```

## Workspace layout

Each research folder gets:

```text
.autoscope/
  config.json
  state.json
  goal.md
  plan.md
  backlog.md
  questions.md
  interesting.md
  sources.jsonl
  evidence.jsonl
  events.jsonl
  cycles/
  reports/
  self-prompts/
  artifacts/
```

The source of truth is on disk. A fresh pi session should be able to read `.autoscope/goal.md`, `.autoscope/plan.md`, `.autoscope/state.json`, recent `.autoscope/cycles/*`, and continue.

## Config

`.autoscope/config.json` defaults:

```json
{
  "autonomy": "full",
  "maxAutoTurns": 50,
  "maxCycles": 50,
  "maxNoProgressCycles": 5,
  "reviewEveryCycles": 3,
  "oracleEveryCycles": 5,
  "requireHumanOnGoalShift": false,
  "settleMs": 800,
  "stopIfRequiresHuman": true,
  "defaultCycleBudget": "one focused subcycle unless evidence requires more"
}
```

## Structured tools

When Autoscope is active, the extension enables tools for durable state updates:

- `log_source` → append `.autoscope/sources.jsonl`
- `log_evidence` → append `.autoscope/evidence.jsonl`
- `log_interesting` → append `.autoscope/interesting.md` and `.autoscope/events.jsonl`
- `log_research_cycle` → write `cycles/cycle-NNN.md`, refresh `self-prompts/next-cycle.md`, advance `state.json`. For long next prompts, write `.autoscope/self-prompts/next-cycle.md` first and pass `nextPromptFile` instead of a huge inline `nextPrompt`.
- `set_research_state` → patch status/auto/requiresHuman/title/cycle index

Large reports and datasets should be written under `.autoscope/artifacts/` or the living Markdown files directly. Avoid sending large artifact bodies through function-call arguments; if a `[truncated]` marker appears, rewrite the full artifact before logging the cycle.

## Compaction

During pi compaction, Autoscope synthesizes a deterministic markdown summary from persisted workspace files: goal, plan, backlog, interesting notes, recent cycles, recent evidence, and recent sources. This avoids relying on a lossy chat summary for long-running research.

## Hooks

Executable hooks can steer the next turn:

```text
.autoscope/hooks/before-cycle.sh
.autoscope/hooks/after-cycle.sh
```

They receive a single JSON object on stdin. Stdout is sent back to the agent as a steer message. Hook metadata is appended to `.autoscope/events.jsonl`.

## Safety

Autoscope can run autonomously, but it still follows pi/global safety rules: no destructive actions, deploys, payments, publishing, or secret disclosure without explicit confirmation.

See `examples/minimal-research/` for a small workspace skeleton.
