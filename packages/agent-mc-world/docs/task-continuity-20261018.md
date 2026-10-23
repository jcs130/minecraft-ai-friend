# Task continuity fixes (0.5.7-rc.26)

## Measured failures

In the 2026-10-18 `r-20261018-110122-775d` run, a first tunnel from feet
`(-495,63,115)` to `(-495,58,112)` was admitted despite the preview already
identifying its invalid slope. It then failed without acting. A later full
inventory caused repeated discard/storage attempts: ordinary discards were
refused because the tunnel did not have four clear blocks or because an explicit
aim was less than two blocks away.

## Shared core changes

- A first, immediate tunnel with a stable measured start rejects the existing
  `tunnel.slope` or `tunnel.spiralAlignment` failure before any enqueue callback,
  queue replacement or interruption. The ordinary tool response carries the
  relevant help and machine-readable admission rule. This changes admission
  timing, not the geometry that the skill can execute.
- A preceding action, queued body owner, checkpoint drain, environmental hold,
  flight, water, airborne state or moving path leaves the real starting cell
  uncertain. Those plans retain their execution-time checks. Preview calls remain
  read-only; aligned spirals and already reached targets retain their contracts.
- Ordinary caller-selected discard no longer requires four clear blocks or a
  two-block minimum aiming distance. The core prefers the longest measured clear
  direction. Without a measured direction it keeps the current aim and reports
  that clearance is unconfirmed. It does not move, mine or retry to create space.
- Server-settled inventory decrease still verifies a discard. Reacquisition is
  reported as failure; recent known discards stay out of generic pickup sweeps.
  Player gifts retain recipient visibility, range and collection evidence checks.

The same core executes these behaviors for SDK, MCP and host adapters. No model,
server, character, paid endpoint or host framework rule is embedded here.
Source tests and packed-consumer checks do not establish production loading,
stable gameplay, commission completion or autonomous learning benefit.
