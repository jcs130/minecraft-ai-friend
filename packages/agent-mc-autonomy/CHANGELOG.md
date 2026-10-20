# Changelog

## 0.2.63 — 2026-10-20

- Pin shared renderer `ce60351c` with original trident GUI icons and the native
  compass random-spin branch. Preserve exact source/build hashes, stack
  identity, enchantment glint and bounded original-frame caches. Include all
  sixteen original plain banner dye models and preserve observed empty pattern
  components; unsupported decorated patterns remain explicit.

## 0.2.62 — 2026-10-20

- Preserve omitted native presentation fields when merging an appearance-only
  optional pack. A missing skills reading no longer inserts `undefined` and
  causes the bounded viewer codec to reject the complete same-player inventory.

## 0.2.61 — 2026-10-20

- Pin shared renderer `d13246f7` and its exact source inventory/builds. Native
  literal custom item names no longer fall back to the base item description;
  the original stack, profile identity and item ID remain unchanged. Optional
  server resource activation remains a separate pack-owned concern.

## 0.2.60 — 2026-10-20

- Permit validated `mc_messages` list/search/read calls while a fresh feedback
  goal awaits its first native plan. The tool has shared read/write tags because
  marking a message reviewed writes metadata; that tag previously blocked even
  pure searches, forcing a body plan before the agent could read its instructions.
- Message review/writes, unknown operations and action/speech tags stay blocked
  at this boundary. Reading does not consume feedback queue policy or count as
  body progress. Native confirmation, unknown receipts and stop fences remain.

## 0.2.59 — 2026-10-20

- Keep bounded server feedback, recent Minecraft messages, equipment/observed
  item IDs and optional-method query entries in the compact strategic review.
  The structured host consumes this view, so retaining them only in the full
  evidence and notification summary left it disconnected from the body.
- Preserve source handles and paged originals. Messages remain dated external
  observations, never user authority or permission; method entries do not impose
  quests or a survival checklist. Record notice/method reads with other queries.
- Pin shared renderer `05b8fefb` and its exact runtime source inventory, including
  the current-health HUD and matrix-authored inventory shield grip fixes. Native
  Java 1.21.1 assets and the bundled original YSM remain separate verified inputs.

## 0.2.58 — 2026-10-20

- Adopt queued revisions of the active host stage at the next coordinator boundary
  instead of cancelling a current inference. Human/unknown feedback, explicit
  replacement, new host stages, stop, native danger, death and failed ahead anchors retain their
  interruption semantics. Advisory requests stay durable and unclaimed until
  normal admission; body work and its queue remain unchanged.
- Journal controller-cancelled inference with its timing and actual reason,
  separately from provider errors and native work. No tool from that inference
  was dispatched; an already running body task is not declared cancelled.

## 0.2.57 — 2026-10-20

- Keep malformed tool-argument originals and exact syntax diagnostics in the
  private journal, instead of replaying them as valid assistant tool examples.
  The next model request receives explicit no-dispatch validation feedback and
  the error location/source reference, without copying the malformed snippet.
- Preserve ordinary valid tool exchanges, exact archived responses, one bounded
  idle JSON correction, repeated-error backoff and all native/stop fences.
  This prevents a runtime-created bad-example loop; it does not identify the
  source of the first malformed provider response or certify live error rates.

## 0.2.56 — 2026-10-20

- Let one known, finite native body task receive one bounded planning opportunity
  before it finishes. The model can read and append one continuation through the
  existing native queue; it cannot cancel, insert into or replace running work.
  Two owned tasks, explicit follow/wait, unknown dispatch, feedback, death and
  provider backoff keep their existing fences. A failed anchor invalidates an
  unfinished ahead inference.
- Do not treat conversation while the body is already working as an idle failure.
  Its reply no longer leaves a no-action timer behind the eventual terminal.
- Count spatial-answer handoffs separately from help/inventory reads, so those
  useful reads cannot consume the two prompt spatial continuation slots.
- Timestamp actual model requests and responses, including rejected/truncated
  replies, and distinguish ordinary and ahead planning in the existing journal.
  Offline regressions do not establish live continuity or completed goals.

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
