# Changelog

## 0.2.53 — 2026-10-20

- Pin core 0.5.7-rc.52: a rules-only organization request handles only the
  specified surplus, without implicitly merging or sorting unrelated stacks.
- Preserve ordinary organization, explicit merge/sort, strict server slot and
  cursor confirmation, original failed receipts and no replay of unknown work.
  The host-neutral planner and model configuration are unchanged.

## 0.2.52 — 2026-10-20

- Pin the independently verified core offhand exchange repair. Stored items use
  one direct F-key swap, leaving unrelated hotbar shortcuts and selected slots
  untouched. Refused or unknown exchanges keep the existing strict barrier.
- Include bounded before/predicted/server stack diagnostics using identity
  hashes rather than raw private item data. Original receipts are preserved;
  this dependency update does not change planner policy or restart any host.

## 0.2.51 — 2026-10-20

- Require validated native effect samples before a completed body request can
  retire preceding failure context. Request-only completion, unchanged/unknown
  effects and forged change flags keep the actual failure available.
- Keep later actions enabled and preserve original failed receipts. Retiring
  context after real change does not certify the earlier objective as achieved.

## 0.2.50 — 2026-10-20

- Keep native body failures and observation-attempt counts after a completed
  camera-only look/inspection task. Turning the view does not establish recovery
  of a blocked movement, item operation or survival goal.
- Execute requested camera turns through the native queue instead of reusing
  cached look results; mixed batches with actual body work retain their action
  semantics. Raw receipts and unknown-operation barriers remain preserved.

## 0.2.48 — 2026-10-20

- Pin the independently built core candidate containing the upstream context
  schema/facts/event helpers and repeated-observation progress API.
- Keep these host-facing SDK helpers opt-in. The Python planner's context
  selection, original journals, native queue and model route are unchanged;
  installing this dependency alone is not a measured latency improvement.

## 0.2.47 — 2026-10-20

- Flush and synchronize host-state writes before atomic replacement. A failed
  write preserves the previous dispatch/stop state; unreadable state blocks
  startup instead of silently resetting or replaying unknown actions.

## 0.2.46 — 2026-10-19

- Accept the explicit vLLM chat parameter `thinking_token_budget`, preserving its
  integer, zero and `-1` (unlimited) semantics. Reject invalid types and budgets
  that consume all configured output space before sending a request.
- Preserve newer Chat servers' `reasoning` in streamed/nonstreamed private
  history and the first-output metric. Replay the original field name under the
  existing provider scope and explicit history policy; never promote it to
  spoken content. Keep `reasoning_content` providers compatible.
- Keep other protocols and unconfigured backends unchanged. This adds a model
  compatibility setting; it does not change the selected model, host SDK or
  ongoing game session, and does not establish live inference performance.

## 0.2.44 — 2026-10-19

- Project/count each full request candidate once, rebuilding only after a real
  budget mutation. Return exactly the projection whose budget was checked.
- Reuse exact unchanged goal text and selected host message, speech receipt and
  memory rows while retaining fresh bindings, selection and expiry metadata.
  Changed provenance/playback states remain literal. Require at least 128 bytes
  of net savings and never reference a container containing other references.
- Rebase references after complete history retirement; keep critical body facts,
  attributed game events, raw archives and the selected model capacity intact.

## 0.2.43 — 2026-10-19

- Return a no-dispatch validation receipt when a goal report races pending
  native work. Preserve the submitted goal and action ownership instead of
  crashing and disconnecting the independent runtime.

## 0.2.42 — 2026-10-19

- Retain the actual selected input scene with its reply and tool results in full
  mode. The next round extends the prior request instead of replacing its input.
- Reuse exact unchanged inventory/knowledge/selected-memory values by in-request
  references; keep current health, location, queue and attributed events literal.
  Rebase retained raw scenes after retirement so references never dangle.
- Enable NInfer prompt-end anchors only for these actual append-only text scenes.
  Persona/source changes retire selected private history; native ownership and
  pending work are preserved. Camera frames remain current-only.

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
