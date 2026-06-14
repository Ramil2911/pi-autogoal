# Minimal Autogoal workspace

Start pi in a repo/folder with this package enabled, then run one of:

```text
/autogoal research Investigate whether retrieval-augmented agent memory improves long-running coding tasks.
/autogoal dev Add a small tested feature and commit it.
/autogoal optimize Reduce test runtime p95 by 20% while preserving correctness.
```

Expected artifacts after initialization:

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
```

For a supervised single cycle:

```text
/autogoal cycle compare official docs and recent papers
```
