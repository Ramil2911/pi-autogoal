---
description: Start a Autoscope autonomous research workspace
argument-hint: "<abstract>"
---
Start or continue a Autoscope research workspace for this abstract:

<abstract>
$ARGUMENTS
</abstract>

If the `/autoscope` extension command is available in this session, the user should prefer `/autoscope start <abstract>` to enable autonomous self-resume. If this prompt is being processed as a normal message, manually follow the `autoscope` skill protocol: initialize `.autoscope/`, run the first research cycle, update the living artifacts, and write `.autoscope/self-prompts/next-cycle.md`. Store large artifacts in files under `.autoscope/` and reference paths; do not pass large artifact bodies through function-call arguments.
