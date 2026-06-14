---
description: Start an Autogoal autonomous workspace
argument-hint: "[research|dev|optimize] <goal>"
---
Start or continue an Autogoal workspace and immediately begin the selected mode loop for this goal:

<goal>
$ARGUMENTS
</goal>

Prefer `/autogoal start [--run <run-id>] [mode] <goal>` when the extension command is available. Supported modes: `research`, `dev`/`development`, and `optimize`/`optimization`. Use `/autogoal init [workspace-title]` only for generic folder scaffolding without a goal.

If processed as a normal message, follow the `autogoal` skill: initialize or refresh `.autogoal/`, infer/read the selected mode, create/preserve a run namespace under `.autogoal/runs/<run-id>/`, run the first focused cycle now, update required state, and refresh `.autogoal/self-prompts/next-cycle.md`.
