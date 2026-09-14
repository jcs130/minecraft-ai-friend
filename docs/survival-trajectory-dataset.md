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
