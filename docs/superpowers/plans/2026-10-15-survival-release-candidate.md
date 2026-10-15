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

- [ ] Add an offline real-world handler regression for a rejected cooked-food craft, asserting `meta.admission.accepted=false`, native rule and a canonical `mc_help` recovery reference, with no queued work changed.
- [ ] Return existing executor rejection metadata and bounded relevant skill documentation without changing admission decisions or calling models.
- [ ] Check targeted tests, complete package tests, typecheck, build and isolated packed SDK before committing.

## Task 2: Independent coordinator recovery

Files: `packages/agent-mc-autonomy/src/agent_mc_autonomy/controller.py`, `tests/test_native_failure_context.py`, `core_distribution/source.json`, package lock and version metadata.

- [ ] Reproduce identical semantic rejection across different turns and assistant call IDs with a fake body.
- [ ] Retain bounded native recovery evidence, suppress repeats only while the observed non-clock facts match, and expire entries so changing server conditions can be rechecked.
- [ ] Verify changed inventory permits dispatch, clocks do not, successful reads do not erase the body error, and accepted/unknown task handling remains intact.
- [ ] Run source and isolated wheel tests, pin the exact committed engine archive, validate disconnected MCP and commit/push normally.

## Task 3: Release candidate and live observation

Files: thin plugin dependency/version, README/CONTRIBUTING/config example, `docs/release-candidate-20261015.md`; private evidence under `local/live-runtime` only.

- [ ] Replace obsolete setup versions with the actual pinned engine manifest and documented explicit build/install commands.
- [ ] Run real SDK plugin tests/Ruff, official Market structure check, clean-stage package and private-file audit.
- [ ] Prepare checksums, install instructions and a Market description with actual supported features and limitations.
- [ ] Save protected Neko file/process baseline, normally drain only the owned executor, deploy checked packages and resume observation.
- [ ] Observe multiple real life/food/inventory/task transitions and death/respawn evidence. Record failures honestly; do not claim long survival from a single sample.
- [ ] Keep the existing heartbeat updated to this architecture and record its comparison baseline without credentials.
