# Context reuse and bounded cleanup implementation plan

Execute sequentially in this session under the user's optimization request.
Do not start the stopped game, invoke a model, or change Neko/SDK sources.

**Goal:** Reuse exact selected context with less repeated input and assembly work,
while retaining current authority, evidence attribution and the 131072 capacity.

**Architecture:** The canonical autonomy package projects raw retained scenes.
It may reference unchanged goal text and exact selected host rows, alongside the
existing fact/receipt references. Fresh envelopes and changed values remain
literal. History retirement stays at complete exchange boundaries and rebases
references. The adapter only consumes an exact package pin.

**Evidence:** Twelve private recorded inputs, never committed. The CPU-only
replay calls the counter seven times per fitting request; warmed median assembly
is 41.69 ms. Twenty-seven repeated speech receipt rows occupy 16,320 bytes.
Goals repeat in ten adjacent pairs. No new model/game/TTS call is needed.

## Constraints and review focus

- Keep 131072 tokens, current model, thinking budget 512 and all original logs.
- Health, position, queue, errors and message facts remain literal.
- Different actor/record/provenance or playback state is a different value.
- A reference must save at least 128 bytes, point to a literal value already in
  this request, and materialize when its source history retires.
- Persona/source changes keep their current privacy invalidation boundary.
- Unknown dispatches and pending actions are never context-cleanup targets.
- No public release or automatic game start. Measure CPU/token effects offline;
  real inference latency requires a separate authorized live trial.

## 1. Measure each assembled candidate once

Files: `context_full.py`, `tests/test_context_assembly_reuse.py`.

- [x] Add a deterministic fitting-request counter spy test:
  `assert counter.calls == 1`, with facts, events, history and outcomes supplied.
- [x] Run `python -m pytest tests/test_context_assembly_reuse.py -q` and record
  the existing repeated calls as the failing signal.
- [x] Keep `(projected_messages, scene_stats, total)` from one `measure()` call.
  Recompute only after a history/section/fact/event mutation; return the exact
  projection that was counted, including the byte fallback path.
- [x] Test overflow, original immutability, framing/output accounting and a
  counter exception that restarts entirely in conservative byte mode.

## 2. Reuse exact repeated host rows and goals

Files: `scene_history.py`, `tests/test_scene_reuse_rows.py`.

- [x] Add tests requiring a changed fresh host envelope to retain freshness
  while referencing its identical selected message/speech/memory rows.
- [x] Test changed actors, IDs, text and playback state, changed goals, short
  values, literal-source-only references, source retirement and full recovery
  through `capture_scene(project_messages(raw)[0])`.
- [x] Extend the existing owned scene projection, not host SDKs or providers.
  Add current goal/host recent section reuse; reuse rows only when their parent
  is literal. Index nested sources only if those rows are actually literal.
- [x] Require at least 128 bytes of net savings per reference. Keep critical
  body facts literal and preserve the actual complete input/reply prefix.
- [x] Re-run focused tests and the private twelve-input replay. Report projected
  input size separately from live latency; keep payload strings private.

## 3. Verify, pin and preserve stop

Files: package version/changelog, `docs/context-window-cache.md`, thin plugin
dependency/version/docs/tests, ignored maintenance evidence.

- [x] Run complete package pytest, changed-file Ruff and isolated packed probe.
- [ ] Fetch main, reconcile concurrent changes, commit and ordinary-push core.
- [ ] Build exact committed wheel, update only adapter dependency/version/docs,
  run official plugin checks and inspect the archive for static metadata and
  excluded private runtime/resources. Ordinary-push the adapter.
- [x] Inspect current Settings/ownership read-only. Set this local 128K session's
  existing `context_history_headroom_tokens` to 8192 through public settings only
  if it is currently zero; preserve all other settings and stopped state.
  This leaves cache room only after a real overflow, never clears pending work,
  and never lowers model capacity.
- [ ] Append maintenance evidence without advancing full inspection. Record
  prepared versus installed versions and explicitly pending live acceptance.

## Verified offline results

- Full package: 1,240 passed; changed-file Ruff and packed independent consumer
  passed. Four targeted regressions failed before the implementation; an
  additional chained-container reference regression failed before its fix.
- Same fitting request: seven counter calls reduced to one; warmed replay
  median 41.69 ms reduced to 6.72 ms. This is CPU assembly, not model latency.
- Same twelve recorded selected scenes: 122,926 input tokens reduced to 109,304,
  saving 13,622 tokens. Every restored scene matched and the already-emitted
  prefix remained unchanged as the next scene was appended.
- Current local Settings already use 131072 context and 8192 retirement
  headroom. They were preserved without a settings write. The executor remains
  stopped, lease unowned, pending count zero, uncertainty false.
- These are offline/input-volume results. The new wheel has not been activated
  in the stopped game and no live latency or stable-survival claim is made.
