# Idle action recovery implementation plan

**Goal:** Preserve actionable rejection evidence while the autonomous player gathers observations, so completed reads cannot conceal a failed survival action.

**Architecture:** The independent autonomy controller owns planner feedback and context. The native Minecraft body keeps sole ownership of actions, queue admission, safety guards and terminal receipts. The Neko adapter remains a thin consumer of a pinned framework package.

**Spec:** User requests continued autonomous vanilla survival and diagnosis of repeated idle behavior; package AGENTS.md defines ownership and verification.

## Constraints

- Keep explicit stop, native barriers, unknown dispatch blocking and durable intent identities.
- Preserve original receipts, user goals, private state and unrelated projects.
- Observation acceptance is not evidence that a rejected body action recovered.
- No manual in-game recovery, extra model probe or additional body queue.

## Work

1. Capture the failed mc_do and intervening queued read from the actual runtime. Replay this sequence through Controller.execute_model_call and request assembly with fake body/model ports. Assert the exact rejection still reaches the next planner request after history eviction. Run red before implementation.
2. Classify queued observation work conservatively; preserve failures across unrelated accepted tasks and clear them only for an accepted corrected call of the same capability. Update the existing same-capability correction test and cover mc_scout, observational mc_do, real-action recovery and unknown outcomes. Run targeted and full framework tests, lint and isolated wheel consumer.
3. If native find labels conflate chicken entities and chicken items, reproduce with the real skill and correct only the observed label. Build/typecheck/test and validate an isolated packed native consumer before changing the checked core pin.
4. Commit canonical fixes, fetch before normal push, update the thin plugin's pinned dependency and release metadata, run its complete release checks and package locally.
5. At an observed idle safe boundary, stop only the owned autonomy runtime through its public stop API, preserve state, launch the checked replacement and restore the authorized standing goal through the durable intent API. Verify actual task completion plus world/inventory change in the existing visible browser. Report remaining limitations honestly.
