# Survival feedback and release candidate implementation plan

**Goal:** Correct the observed repeated rejected cooking plans, observe real survival progress, and prepare a truthful installable Minecraft Autonomous candidate.

**Architecture:** The Minecraft body returns structured admission evidence and relevant native skill documentation. The independent turn coordinator retains this evidence at the dynamic request tail and suppresses unchanged repeated admission attempts with a bounded lifetime. The Neko adapter consumes the checked package; the host and SDK are read-only.

**Tech stack:** Mineflayer Java 1.21.1, TypeScript/Vitest, Python/pytest, official Neko plugin CLI.

**Spec:** Current user request and package AGENTS.md: continue real survival, prepare release, preserve core/viewer/host boundaries, no host code changes.

## Constraints and review focus

- Java 1.21.1 is the primary target; exact received data enables optional server features.
- No network, model or game actions in offline tests; real gameplay verification is a separate operator step.
- A rejected batch must not alter existing work; accepted tasks and model claims are not verified progress.
- Recipe/material changes must allow reconsideration; timestamps alone must not bypass suppression.
- Native accepted failures and unknown dispatches retain existing reconciliation semantics.
- New packages contain no private state, secrets, world saves or host source; no automatic gameplay on installation.
- Prepare artifacts and Market text; publish/tag only after the actual readiness criteria are met and publication is requested.

## Task 1: Native admission evidence

Files: `packages/agent-mc-world/core/world.ts`, `packages/agent-mc-world/tests/task-admission-evidence.test.ts`.

- [x] Add an offline real-world handler regression for a rejected cooked-food craft, asserting `meta.admission.accepted=false`, native rule and a canonical `mc_help` recovery reference, with no queued work changed.
- [x] Return existing executor rejection metadata and relevant skill documentation without changing admission decisions or calling models; the coordinator bounds the dynamic preview and keeps the full receipt.
- [x] Check targeted tests, complete package tests, typecheck, build and isolated packed SDK before committing.

## Task 2: Independent coordinator recovery

Files: `packages/agent-mc-autonomy/src/agent_mc_autonomy/controller.py`, `tests/test_native_failure_context.py`, `core_distribution/source.json`, package lock and version metadata.

- [x] Reproduce identical semantic rejection across different turns and assistant call IDs with a fake body.
- [x] Retain bounded native recovery evidence, suppress repeats only while the observed non-clock facts match, and expire entries so changing server conditions can be rechecked.
- [x] Verify changed inventory permits dispatch, clocks do not, successful reads do not erase the body error, and accepted/unknown task handling remains intact.
- [x] Run source and isolated wheel tests, pin the exact committed engine archive, validate disconnected MCP and commit/push normally.

## Task 3: Release candidate and live observation

Files: thin plugin dependency/version, README/CONTRIBUTING/config example, `docs/release-candidate-20261015.md`; private evidence under `local/live-runtime` only.

- [x] Replace obsolete setup versions with the actual pinned engine manifest and documented explicit build/install commands.
- [x] Run real SDK plugin tests/Ruff, official Market structure check, clean-stage package and private-file audit.
- [x] Prepare checksums, install instructions and a Market description with actual supported features and limitations.
- [x] Save protected Neko file/process baseline, normally drain only the owned executor, deploy checked packages and resume observation.
- [x] Observe multiple real life/food/inventory/task transitions and death/respawn evidence. Record failures honestly; do not claim long survival from a single sample.
- [x] Keep the existing heartbeat updated to this architecture and record its comparison baseline without credentials.

## Evidence-driven follow-up: named-item knowledge

Live `egg food cook` retrieved generic cooked-food records before the egg. Core 0.5.4 adds whole-ID/compound/Chinese-name ranking and explicit non-food summaries, with a leading synchronized no-food fact. New regression cases failed before the fix. Final core: 824 passed, two conditional headless skips, canonical build/typecheck/isolated packed consumer checked. Runtime 0.1.48: source/wheel each 414 passed. Adapter 0.5.31: 58 Python and four browser-data cases, Ruff and official release structure check passed. All changes pushed to the appropriate main branches.

Candidate preparation is complete; stable publication remains blocked by actual gameplay. At 14:33:09 Beijing the server recorded `ag_NEKO was slain by Drowned`; subsequent health recovery was respawn. After new wood, fishing rod and sword were actually obtained, food still fell to 5/20 during searches at 14:47. Core 0.5.4 / runtime 0.1.48 are deployed, the public Neko decision-slot probe passed, and 5,273 protected host files plus four protected service identities are unchanged. Keep real survival follow-up active; do not tag/publish based on offline checks or these short gameplay observations.
