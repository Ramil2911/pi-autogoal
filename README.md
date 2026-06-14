# pi-autogoal

Autonomous goal loops for [pi](https://pi.dev/): research, development, and metric optimization.

## Modes

- **Research** — the existing long-running sources/findings/leads/cycle-report workflow.
- **Development** — autonomous code work in implement → test → review → commit cycles. Normal durable output is git commits, not long-lived reports/artifacts.
- **Optimization** — autonomous research and experiments to improve a named metric, with reproducible measurements and metric logs.

## What it provides

- `/autogoal` command implemented as a pi extension.
- `autogoal` skill with mode-specific protocols.
- Workspace state in `.autogoal/`, so each repo/folder has durable goal state.
- Autonomous self-prompting via `agent_end -> sendUserMessage(next-cycle)`.
- Structured tools: `log_source`, `log_finding`, `log_lead`, `log_metric`, `prepare_worktree`, `log_goal_cycle`, `set_goal_state`.
- Git worktree defaults for isolated branches; development starts create a worktree automatically when available.
- Subagent guidance for planner/worker/reviewer/oracle flows, acceptance contracts, and pi-intercom coordination.
- Deterministic compaction summary from persisted `.autogoal/` state.
- Optional lifecycle hooks: `.autogoal/hooks/before-cycle.sh` and `.autogoal/hooks/after-cycle.sh`.

## Install

Install the package from GitHub:

```bash
pi install https://github.com/Ramil2911/pi-autogoal
```

For local development, run the command from this repository checkout:

```bash
pi install .
```

Or enable a local checkout in one workspace with `.pi/settings.json`:

```json
{
  "packages": ["/path/to/pi-autogoal"]
}
```

Then restart pi or run `/reload`.

## Commands

### Initialize or start a goal

Use `init` when you only want to create the generic `.autogoal/` workspace scaffolding for the current folder without choosing a goal or starting autonomous self-resume:

```text
/autogoal init [workspace-title]
```

Use `start` when you want to choose the mode and begin a specific goal loop:

```text
/autogoal start [mode] <goal>
/autogoal start --run <run-id> [mode] <goal>
```

Modes: `research`, `dev`/`development`, `opt`/`optimize`/`optimization`.

Every `start` creates a run namespace under `.autogoal/runs/<run-id>/`. If the requested run id already exists, Autogoal allocates a suffix such as `feature-2` instead of overwriting previous artifacts.

Development starts also create a git worktree by default when `.autogoal/config.json` has `worktrees.enabled: true` and the current folder is a git repository. The worktree path is stored in `.autogoal/state.json` as `worktreePath`, and the first-cycle prompt tells the agent to do code edits, tests, reviews, and commits there. If worktree creation fails, Autogoal warns and continues in the current checkout.

### Mode shortcuts

These are clearer aliases for `start [mode]`:

```text
/autogoal research <goal>
/autogoal dev <goal>
/autogoal optimize <metric/goal>
/autogoal dev --run feature-a <goal>
```

Examples:

```text
/autogoal research Compare local-first agent memory designs
/autogoal dev Add worktree cleanup support and commit it
/autogoal optimize Reduce npm test runtime by 30%
```

### Manual cycle and controls

```text
/autogoal cycle [focus]
/autogoal pause
/autogoal resume
/autogoal off
/autogoal status
```

- `cycle` runs one supervised cycle without enabling auto-resume.
- `pause` stops auto-resume but keeps tools/state available.
- `resume` enables auto-resume again and sends the next-cycle prompt.
- `off` stops Autogoal and disables gated Autogoal tools.
- `status` shows the active mode, cycle counters, findings/leads/metric counts, and human gate state.

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
  leads.md
  subagents.md
  sources.jsonl
  findings.jsonl
  metrics.jsonl
  events.jsonl
  cycles/
  reports/
  self-prompts/next-cycle.md
  artifacts/
  runs/<run-id>/
    goal.md
    plan.md
    cycles/
    artifacts/
```

The top-level files are the active workspace view for compatibility. Per-run files under `runs/<run-id>/` preserve artifacts from previous and sibling runs.

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
- `log_finding` → append `.autogoal/findings.jsonl` for checked conclusions
- `log_lead` → append `.autogoal/leads.md` for unverified follow-up ideas
- `log_metric` → append `.autogoal/metrics.jsonl` for optimization measurements
- `prepare_worktree` → create an isolated git worktree/branch and record it in state
- `log_goal_cycle` → write `cycles/cycle-NNN.md`, refresh `self-prompts/next-cycle.md`, advance `state.json`
- `set_goal_state` → patch mode/status/auto/title/metric/repo/branch/worktree/human gate

Development mode should normally leave durable progress in git commits. `log_goal_cycle` is still available for state advancement and next-cycle prompts.

## GitHub and worktrees

Autogoal may use local git and the GitHub CLI (`gh`) when available. In development mode, `/autogoal start dev ...` creates an isolated worktree by default when worktrees are enabled. External mutations still require explicit user confirmation: push, publish, deploy, repository rename, destructive changes, or remote settings changes.

## Compaction and hooks

During pi compaction, Autogoal synthesizes a deterministic markdown summary from persisted workspace files: goal, mode, plan, backlog, leads, recent cycles, sources, findings, and metrics.

Executable hooks can steer the next turn:

```text
.autogoal/hooks/before-cycle.sh
.autogoal/hooks/after-cycle.sh
```

They receive a JSON object on stdin. Stdout is sent back as a steer message. Hook metadata is appended to `.autogoal/events.jsonl`.

## Safety

Autogoal can run autonomously, but it still follows pi/global safety rules: no destructive actions, deploys, payments, publishing, remote repository mutations, or secret disclosure without explicit confirmation.
