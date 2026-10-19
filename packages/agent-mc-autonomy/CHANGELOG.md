# Changelog

## 0.2.40 — 2026-10-19

- Fix premature full-context history retirement for explicitly configured local
  NInfer Chat deployments. A hash-bound CPU tokenizer/template counter uses the
  real planner wire projection and retains the conservative fallback.
- Reuse an event's exact duplicate receipt value without merging events, actors,
  attempts, original archives or action authority.
- Keep the selected model, context capacity, thinking budget, native queue and
  host SDK unchanged. Live cache/latency gains require separate observation.
