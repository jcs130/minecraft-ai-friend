# Local planner context retention and exact evidence reuse

> Execute sequentially in the current session. Use the existing public counter and
> planner ports, fake-body regression tests, and an isolated packed consumer.

**Goal:** Preserve the configured 131072-token window and immutable history instead
of retiring it at 131072 UTF-8 bytes, while removing exact duplicate receipt values.

**Architecture:** The independent autonomy package owns an explicitly configured,
CPU-only NInfer Chat counter. Its tokenizer/template are operator-supplied and
SHA256-bound to the selected model and endpoint. The same wire codec used by the
planner supplies its messages. Missing dependencies, changed resources, media, or
unsupported semantics fall back to the existing byte upper bound. No model or
server discovery, new inference loop, SDK patch, or independent action queue.

**Tech stack:** Python 3.11, optional tokenizers/Jinja2, existing HttpPlanner and
ContextCounter, pytest; the thin plugin consumes a fixed framework commit.

**Spec/evidence:** The user's request to optimize context without shrinking 128K,
plus private read-only request metrics (latest ten requests: median 20.807 s,
13.814 s prefill, 38481 prompt tokens, 13121 cached, 25360 computed). Six existing
private requests can be counted exactly on CPU using the served artifact's files.
Private requests, personas, reasoning, resources and runtime files stay outside Git.

**Field follow-up:** CPU counting fixed premature retirement, but the first
deployments still reused only ~13K tokens. Two isolated replays of identical
37,389-token input reused 37,382 tokens on the second attempt. The controller
discarded its actual scene input while retaining only output/tool exchanges,
so live turns did not extend the cached prompt. Preserve complete text scenes
with their replies; use lossless selected-field references, rebased from raw
retained snapshots after eviction. Re-enable prompt-end anchors only for this
actual append-only path. Check persona invalidation and current-only images.

**Verification before the scene-history deployment:** 1,223 package tests passed
serially; the packed wheel passed the independent network/host-denied consumer
probe and CPU counter check. Ruff passed for all changed Python files. The wider
package still has existing lint failures outside this change; do not claim its
global CI is green. Real latency after deploying complete scene history is still
pending and must be recorded separately from this offline evidence.

## Constraints and review focus

- Keep raw messages, receipts, event cursors, user feedback, original queries,
  persona and tool schemas. Equal text from different actors is not one event.
- Retire only complete history groups at the actual configured window. Report
  fallback/omissions honestly; never turn a reference into action authority.
- Bind resource hashes and model route. Do not use the old Strata tokenizer or
  contact a count/inference API from ContextCounter.
- Test nested tool arguments, native reasoning replay, resource replacement,
  literal special tokens, media and marker collisions. Fail closed to byte mode.
- Neko main/SDK, current model, Java server and private world stay continuous.
  Replace only the exact-owned independent executor after normal queue drain.

## Implementation

### 1. Local counter and planner wiring

Files: `packages/agent-mc-autonomy/src/agent_mc_autonomy/local_counter.py`,
`model_config.py`, `planner.py`, `pyproject.toml`, `tests/test_local_counter.py`.

- [ ] Add regressions for explicit configuration, CPU count parity, immutable
  originals, real full-context retention, fallback and invalid binding.
- [ ] Run `python -m pytest tests/test_local_counter.py -q`; confirm the new
  regression fails on the current missing config/counter path.
- [ ] Implement the optional local counter through HttpPlanner's existing port.
  Normalize NInfer function definitions and JSON arguments; apply the same
  scoped reasoning history as the wire codec. Read only pinned local files.
- [ ] Run the focused tests and replay six private requests without inference.
  Require zero count difference from their recorded server prompt token usage.

### 2. Exact same-event receipt reuse

Files: `context_full.py`, `tests/test_context_evidence.py`.

- [ ] Add a regression with a long event text identical to that same event's
  execution evidence receipt. Require one literal plus an explicit local
  reference, unchanged originals, and two distinct events retained.
- [ ] Run the regression red, apply existing `project_values` to full-mode event
  copies, then run full context/evidence/controller regressions.
- [ ] Document configuration, scope, optional dependencies and safe fallback;
  bump the framework patch version and verify the complete package tests.

### 3. Pin, deploy and observe

- [ ] Fetch main, verify staged scope, commit and ordinary-push framework main.
- [ ] Build the exact committed wheel, run isolated consumer checks, update only
  the thin plugin dependency/version/docs and complete its required checks.
- [ ] Verify a clean plugin candidate and ordinary-push the adapter main.
- [ ] Record current ownership and protected process birth times. Drain through
  the normal stop mailbox; never clear unknown receipts or replay tasks.
- [ ] Install the verified candidate, configure the explicit local resource
  binding, and resume the same authorized goal with an owned launcher.
- [ ] Measure natural real game requests after warmup: input/cached/computed
  tokens, prefill/total latency, retained history and actual action receipts.
  Keep thinking budget, model and 128K capacity unchanged to isolate this change.
- [ ] Record private deployment/inspection proof. Distinguish test results,
  observed latency improvement and unaccepted long-term survival.
