# pi-autogoal

Autonomous goal loops for [pi](https://pi.dev/): research, development, and metric optimization.

## Modes

- **Research** — the existing long-running evidence/sources/cycle-report workflow.
- **Development** — autonomous code work in implement → test → review → commit cycles. Normal durable output is git commits, not long-lived reports/artifacts.
- **Optimization** — autonomous research and experiments to improve a named metric, with reproducible measurements and metric logs.

## What it provides

- `/autogoal` command implemented as a pi extension.
- `autogoal` skill with mode-specific protocols.
- Workspace state in `.autogoal/`, so each repo/folder has durable goal state.
- Autonomous self-prompting via `agent_end -> sendUserMessage(next-cycle)`.
- Structured tools: `log_source`, `log_evidence`, `log_interesting`, `log_metric`, `log_commit`, `prepare_worktree`, `log_goal_cycle`, `set_goal_state`.
- Git worktree defaults for isolated branches.
- Subagent guidance for planner/worker/reviewer/oracle flows, acceptance contracts, and pi-intercom coordination.
- Deterministic compaction summary from persisted `.autogoal/` state.
- Optional lifecycle hooks: `.autogoal/hooks/before-cycle.sh` and `.autogoal/hooks/after-cycle.sh`.

## Install locally

```bash
pi install /home/ramil/personal/autoresearcher
```

Or enable it in one workspace with `.pi/settings.json`:

```json
{
  "packages": ["/home/ramil/personal/autoresearcher"]
}
```

Then restart pi or run `/reload`.

## Commands

```text
/autogoal init [mode] [title]
/autogoal start [mode] <goal>
/autogoal research <goal>
/autogoal dev <goal>
/autogoal optimize <metric/goal>
/autogoal cycle [focus]
/autogoal pause
/autogoal resume
/autogoal off
/autogoal status
```

Modes accept aliases: `research`, `dev`/`development`, `opt`/`optimize`/`optimization`.

## Workspace layout

```text
.autogoal/
  config.json
  state.json
  goal.md
  mode.md
  plan.md
  backlog.md
  questions.md
  interesting.md
  subagents.md
  sources.jsonl
  evidence.jsonl
  metrics.jsonl
  commits.jsonl
  events.jsonl
  cycles/
  reports/
  self-prompts/next-cycle.md
  artifacts/
```

The source of truth is on disk. A fresh pi session should be able to read `.autogoal/goal.md`, `.autogoal/mode.md`, `.autogoal/plan.md`, `.autogoal/state.json`, recent `.autogoal/cycles/*`, and continue.

## Config highlights

`.autogoal/config.json` includes autonomy/cycle limits plus:

```json
{
  "worktrees": {
    "enabled": true,
    "root": "../.autogoal-worktrees",
    "branchPrefix": "autogoal/",
    "cleanupMerged": false
  },
  "subagents": {
    "enabled": true,
    "preferredAgents": ["scout", "planner", "worker", "reviewer", "oracle", "researcher", "delegate"],
    "useAcceptance": true,
    "useIntercom": true,
    "maxParallel": 4,
    "timeoutPolicy": "no-timeout-by-default; if required, use an intentionally high limit and document why"
  }
}
```

Subagent recommendation: do **not** set `timeoutMs`/`maxRuntimeMs` for autonomous subagent work by default. If a limit is required, make it intentionally high and document why.

## Structured tools

- `log_source` → append `.autogoal/sources.jsonl`
- `log_evidence` → append `.autogoal/evidence.jsonl`
- `log_interesting` → append `.autogoal/interesting.md` and `.autogoal/events.jsonl`
- `log_metric` → append `.autogoal/metrics.jsonl` for optimization measurements
- `log_commit` → append `.autogoal/commits.jsonl` for development commits
- `prepare_worktree` → create an isolated git worktree/branch and record it in state
- `log_goal_cycle` → write `cycles/cycle-NNN.md`, refresh `self-prompts/next-cycle.md`, advance `state.json`
- `set_goal_state` → patch mode/status/auto/title/metric/repo/branch/worktree/human gate

Development mode should normally leave durable progress in git commits. `log_goal_cycle` is still available for state advancement and next-cycle prompts.

## GitHub and worktrees

Autogoal may use local git and the GitHub CLI (`gh`) when available. External mutations still require explicit user confirmation: push, publish, deploy, repository rename, destructive changes, or remote settings changes.

## Compaction and hooks

During pi compaction, Autogoal synthesizes a deterministic markdown summary from persisted workspace files: goal, mode, plan, backlog, interesting notes, recent cycles, evidence, sources, metrics, and commits.

Executable hooks can steer the next turn:

```text
.autogoal/hooks/before-cycle.sh
.autogoal/hooks/after-cycle.sh
```

They receive a JSON object on stdin. Stdout is sent back as a steer message. Hook metadata is appended to `.autogoal/events.jsonl`.

## Safety

Autogoal can run autonomously, but it still follows pi/global safety rules: no destructive actions, deploys, payments, publishing, remote repository mutations, or secret disclosure without explicit confirmation.
