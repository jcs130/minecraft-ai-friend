# Changelog

## 0.2.41 — 2026-10-19

- Keep a fixed NInfer checkpoint plus overlapping recent history boundaries so
  real repeated demand can replace stale cache entries under memory pressure.
- Do not implicitly checkpoint the controller's replaced scene or automatically
  create a private prompt-end anchor. Explicit user cache keys remain supported.

## 0.2.40 — 2026-10-19

- Fix premature full-context history retirement for explicitly configured local
  NInfer Chat deployments. A hash-bound CPU tokenizer/template counter uses the
  real planner wire projection and retains the conservative fallback.
- Reuse an event's exact duplicate receipt value without merging events, actors,
  attempts, original archives or action authority.
- Keep the selected model, context capacity, thinking budget, native queue and
  host SDK unchanged. Live cache/latency gains require separate observation.
