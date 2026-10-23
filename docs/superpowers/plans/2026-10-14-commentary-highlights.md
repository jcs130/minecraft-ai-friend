# Commentary highlights implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep natural, short game commentary without reading inventory lists or narrating every inspection.

**Architecture:** The independent framework projects fresh observations into meaningful commentary signals. The thin Neko adapter applies its existing presentation interval, conveys a concise speaking opportunity alongside strategic reviews, and continues using official host voice. Strategic review acknowledgement and native action dispatch remain independent of speech.

**Tech Stack:** Python 3.11+, pytest, public Neko SDK, existing file-backed adapter presentation receipts.

**Spec:** User feedback on 2026-10-14: speak about highlights like a streamer; avoid inventory readouts, but retain natural reactions and conversation. Viewer must be verified against the latest upstream source and actual served bundle.

## Global constraints

- Do not change native queue ownership, task UUIDs, explicit stop, unknown dispatch, or user-goal priority.
- No additional model calls, TTS service, game chat messages, or hard-coded host imports in the framework.
- Official public push_message cannot enforce silent tool-only model execution; make that limitation explicit in validation.
- Preserve all private runtime state and unrelated changes. Deploy only the adapter if the running framework does not need new gameplay code.
- Existing presentation.min_interval_seconds controls ordinary speaking opportunities; new danger/death may bypass it once per changed signal.

## Review focus

- Inventory counts, held item and durability change without meaningful progress: no new speaking opportunity.
- Low-health transition and death: one timely warning, not repeated warnings for the same snapshot.
- Goal/queue inspection: complete facts remain available internally; inspection is not spoken as an action or achievement.
- New useful progress and user conversation: short natural commentary remains available; user questions are not silenced.
- Stale snapshots and rejected delivery: never announce stale state or consume an opportunity on failed submission.

### Task 1: Neutral observation projection

**Files:** `packages/agent-mc-autonomy/src/agent_mc_autonomy/commentary.py`, `packages/agent-mc-autonomy/tests/test_commentary.py`, `packages/agent-mc-autonomy/src/agent_mc_autonomy/review.py`, package version and README.

- [x] Add offline regression tests for count/durability/held-item noise, health thresholds, first observation, stale data and successful useful task versus look-only task.
- [x] Run `python -m pytest tests/test_commentary.py tests/test_review.py -q` in the package and confirm the new import fails before implementation.
- [x] Implement `commentary_observation(status, now)` returning a bounded neutral `signature`, `baseline`, and `payload`, with complete raw evidence unchanged. Implement `commentary_changes(current, previous)` for meaningful topics and urgent transitions.
- [x] Remove instructions to speak from all framework review receipts; return only acknowledgement/dispatch facts.
- [x] Run full package pytest (369 passed), package runtime Ruff and changed-file import checks, plus an isolated wheel consumer/standalone probe. Commit/push evidence is recorded with deployment in the consuming plugin.

### Task 2: Thin host presentation adapter

**Files:** plugin `neko_heartbeat.py`, `neko_presentation.py`, `neko_tools.py`, `tests/test_heartbeat.py`, `tests/test_presentation.py`, README, manifest/project versions and fixed framework dependency.

- [x] Add tests demonstrating that strategic reviews still request inspect/continue/insert, while their speech instructions forbid inventory/inspection readouts and allow a concise highlight or silence.
- [x] Forward the framework projection, share presentation interval with strategic heartbeat commentary, and attach the same bounded commentary instruction to inspection/decision replies. Persist submission opportunities truthfully, not playback success.
- [x] Replace inventory-heavy narration text with one highlighted event/current activity and short natural-language guidance. Direct user questions remain normal.
- [x] Run adapter pytest (56), Node observer tests (4), Ruff and official release/Market structure checks; inspect staged files and packaged contents, then commit and push.
- [x] Reload the development adapter through the normal public API, preserving the independent game/model/server processes. Verify fresh tool receipts, voice delivery/playback, and live viewer identity. Subsequent 0.5.14 moved the 30-character limit into the notification preview because tool-return guidance alone did not control a main brain that skipped inspect. Natural voice playback now includes approximately 3- and 7-second samples; hard silent output is still not enforced by the public host SDK.
