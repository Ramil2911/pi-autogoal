---
description: Run one Autogoal cycle
argument-hint: "[focus]"
---
Run one focused Autogoal cycle.

Optional focus:

<focus>
$ARGUMENTS
</focus>

Use `.autogoal/` as the source of truth. Read current mode/goal/plan/backlog/subagents guidance, execute one mode-appropriate subcycle, update required state, and refresh `.autogoal/self-prompts/next-cycle.md`.

In development mode, durable progress should normally be verified git commits, not long-lived reports/artifacts. In optimization mode, record metric observations. In research mode, record sources/findings/leads.
