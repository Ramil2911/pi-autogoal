---
description: Start an Autogoal autonomous workspace
argument-hint: "[research|dev|optimize] <goal>"
---
Start or continue an Autogoal workspace for this goal:

<goal>
$ARGUMENTS
</goal>

Prefer `/autogoal start [mode] <goal>` when the extension command is available. Supported modes: `research`, `dev`/`development`, and `optimize`/`optimization`.

If processed as a normal message, follow the `autogoal` skill: initialize `.autogoal/`, infer/read mode, run the first focused cycle, update required state, and refresh `.autogoal/self-prompts/next-cycle.md`.
