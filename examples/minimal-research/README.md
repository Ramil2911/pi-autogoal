# Minimal Autoscope workspace

Start pi in an empty research folder with this package enabled, then run:

```text
/autoscope start Investigate whether retrieval-augmented agent memory improves long-running coding tasks.
```

Expected artifacts after initialization:

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
  self-prompts/next-cycle.md
  artifacts/
```

For a supervised single cycle:

```text
/autoscope cycle compare official docs and recent papers
```

