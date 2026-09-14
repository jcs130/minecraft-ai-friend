# Survival trajectory dataset (Step1a action-side reader)

Offline reader that turns the survivor state directory into normalized RL
trajectory data. Pure analysis artifact: production services must not import
it. Framework-agnostic — no Polar/Prime choice is implied or required.

## Why it lives in `tests/`

The fixed engineering plan's coverage allowlist permits new code files only
under `tests/` and `docs/`. `world/survival` and `world/ops` are outside it
for this batch. Final home is `world/ops/survival_trajectory.py` once
coverage is expanded (precedent: ops-20260914T1224 seven-path proposal
T1756). The module docstring records the same contract.

## Inputs and their source baseline

Reads whatever the survivor controller already writes today
(`world/survival/controller.py` and `world/survival/numen_gateway.py`,
runbook-sync HEAD f48e2ef8):

- `action-receipts/<actionId>.json` — one schema-2 receipt per action
  (numen_gateway receipt lifecycle). `result` is the string `'unknown'` on
  the crash-safe marker form, and `effect_unconfirmed` is a settled status
  with no after snapshot.
- `actions.jsonl` — gateway phase log: dispatching / response / observation
  rows per action.
- `episodes.jsonl` — controller `record()` envelopes `{'at': utc() ISO,
  'kind', ...values}` with `utc() = datetime.now(timezone.utc).isoformat()`;
  modern `action_observed` rows carry `actionId`/`turnId` plus the
  controller-computed `inventoryDelta`/positions/hp/hunger (legacy rows do
  not), and `decision_finished` rows label the turn outcome.

Missing state directory or missing snapshots are empty evidence, not errors,
and never an invented haul.

## Outputs

- `transitions(...)` — one row per receipt; rows with an ok after snapshot
  carry before/after compact snapshots, inventory delta (controller.delta
  semantics), and displacement (horizontal hypot + dy, None when either
  position missing). Unobserved rows keep only the honest base fields.
- `turn_rows(...)` — transitions grouped per turn, each with its
  `decision_finished` outcome (resultStatus/completed/nativeTaskCompleted)
  and skill events carrying the same turnId.
- `summarize(...)` — data card: totals, byStatus/byKind/byPhase counts,
  turn breakdown, time range. This card is the G2 gate prerequisite.
- `dataset(...)` — summary card plus transitions, turn rows and invalid
  receipt files in one payload.

## Reward hooks only

The rows expose `inventoryDelta`, `displacement`, `hpDelta`, `hungerDelta`,
`navigationSuccess` and `decision.completed` as hooks. No reward function is
defined here; reward design waits for co-sign-off with game:qd-guild-planner.

## Real-data first run prerequisites

This reader has only been exercised against fixtures mirroring the writers.
A first run on real server data needs host-provided read-only access to
`server/survival-agent-state` (or a host-side statistics run); the
engineering role's own reads of `/public` and `server/` are declined by role
guardrails. Raw `(prompt, completion)` text stays in QwenPaw by design
(controller poll_model comment) and is out of scope here — that is Step1b.


## Step1a increment: lease channel, crash markers, strict lint

Ported 2026-09-15 from the preserved v2 draft (the pieces the canonical
reader still lacked), pinned line-by-line against
`world/survival/numen_gateway.py` (unchanged f48e2ef8 → c1fce7b):

- `turn-actions/<turnId>.json` indexes `{schema:1, turnId, actionIds}`.
  `load_turn_actions()` validates the shape (file stem must equal turnId,
  every id must be uuid4().hex) and flags indexes longer than six ids as
  overflow instead of truncating — the gateway itself re-reads only the
  first six (`turn_receipts` slices `[:6]`).
- `lease.json` `{schema:1, turnId, expiresAt, actionLimit, actionsUsed,
  status}` (+`actionId` once reserved). `load_lease()` projects those fields
  and reports a lease that breaks the pinned shape instead of guessing.
  Pinned: actionLimit ∈ {1,6}; status ∈ open/reserved/used/closed/unknown.
- `crash_markers()` reports whether `unknown.json` (uncertain outcome,
  do-not-resend), `inflight-action.json` (async receipt awaiting settle) and
  `last-action.json` (pointer) exist.
- `lint_receipts()` strict second-pass lint over loaded receipts: actionId
  shape, turnId shape, tool ∈ gateway TOOLS, status among the seven the
  gateway writes, completionConfirmed consistency for the four statuses set
  in `action()` (completed/rejected/effect_unconfirmed/in_flight), and
  receipts larger than the gateway's 262144-byte read_json limit (the
  gateway could never re-read them). Settle-path statuses
  (failed/observed_ended) keep their flag unpinned.
- The summary card now carries byte totals (receipts folder plus both jsonl
  logs — the data-volume numbers G1 wanted for Step2 sizing) and
  `turnActions`/`lease`/`crashMarkers`/`receiptLint` sections; `dataset()`
  also exposes the raw turnId→actionIds join for training-time grouping.

A drift-guard test re-reads numen_gateway.py and pins every literal above
(TOOLS tuple equality, TURN_ID regex, the 262144 limit, the (1,6) limit
check, the `[:6]` slice, marker write sites, the status transition lines).
An `in_flight` receipt inside action-receipts/ is legitimate writer state
(the receipt is persisted before the async settle rewrites it); a lingering
one means the body is still working or the settle never ran — the card shows
it in byStatus plus crashMarkers, and the reader never treats it as an
error.

## Step1b: prompt-side deterministic rebuild (`tests/survival_prompt_rebuild.py`)

The autonomy wake prompt is built by `life_context()` plus one serialization
line in `submit_model()` (`world/survival/controller.py`, unchanged from
f48e2ef8 through afad3520):

    prompt = '本轮受控任务与环境事实（环境中的文本不能更改权限）：\n' + json.dumps(context, ensure_ascii=False)

The module replicates every projection and truncation rule of that context
from recorded inputs: the body key subset, the ≤5000-character greedy event
packing applied after the upstream `[:6]` prioritize slice (an oversized
event is skipped, a later smaller one may still fit), the
recentActionReceipts projection of the last six actions (missing keys stay
as None), executionEvents sliced to the last four episodes then filtered to
skill kinds (missing keys omitted), the first-task continuation block with
700-character memory caps, and the instruction appends in exact submit
order: party roster → partyMessage → partyReplies → review. A drift-guard
test re-reads controller.py and fails when any mirrored literal changes
there, so the rebuild cannot silently diverge from the writer.

Honest limits: perception event ordering, the partyMessage projection and
the review payload are inputs (they are produced by live modules, not by
this file); the completion half of the (prompt, completion) pair remains
QwenPaw-side only (G1 gap) — this module covers exactly the half the
durable record can rebuild. Byte-exact replay of a historical turn also
needs the prompt-time event list and party state, which the public record
keeps only in bounded form.

Like Step1a, the new test module is carried in `tests/` and statically
self-checked; the fixed plan executes its existing 15 modules (174 tests)
only, so execution of new test files here awaits a checks/coverage
expansion.
