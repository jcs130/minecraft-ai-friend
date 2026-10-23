# Neko upstream core update implementation plan

> Execute in the current session using the existing source/package/deployment workflow.

**Goal:** Consume the current independent Minecraft core in the Neko adapter and report observed gameplay honestly.

**Architecture:** Game capabilities stay in `packages/agent-mc-world`; the neutral runtime pins its independently built archive. The Neko adapter only pins the runtime. Viewer resources remain separately pinned because its upstream has no new renderer changes.

**Tech stack:** TypeScript, pnpm 11.5, Python 3.11, public Neko plugin SDK, Mineflayer Java 1.21.1.

**Spec:** User request to review ongoing behavior and update upstream; component ownership is defined in `packages/agent-mc-world/docs/component-boundaries.md`.

## Constraints and review focus

- Preserve the current model, private configuration, world/account, original receipts and explicit stop.
- Do not modify or restart the Neko host/SDK, Java server or working model.
- Preserve untracked work and fetch main before editing and before normal pushes.
- New context helpers are explicit SDK APIs. Do not silently enable server-specific filtering or claim that merely exporting helpers changed planner latency.
- A terminal native task includes observations and chat; it is not proof of a completed survival objective.
- Native unknown dispatch blocks handover; do not reset state, replay actions or manufacture success.
- Keep source synchronization, archive verification, installed dependencies and live observations separate.

## Task 1: Upstream source and core artifact

- [x] Fetch core, plugin and viewer main; inspect scoped incoming changes.
- [x] Read current identity, ownership, raw decisions/events, inventory and voice receipts.
- [ ] Bump the core candidate version in `packages/agent-mc-world/package.json`; document the public context helper additions in its README.
- [ ] Run the full core tests, declaration/type checks and engine build. Commit the candidate source.
- [ ] Archive that exact Git source, build through the official engine pipeline and record archive/build/entry/declaration hashes.

## Task 2: Pin neutral runtime and thin adapter

- [ ] Update `packages/agent-mc-autonomy/src/agent_mc_autonomy/core_distribution/{source.json,package.json,package-lock.json}` without unrelated dependency changes.
- [ ] Bump the runtime candidate and describe helper opt-in semantics in README/changelog.
- [ ] Run runtime tests, build a wheel, install the pinned core in a separate directory and run disconnected packed-consumer verification.
- [ ] Commit/push the validated framework source after fetching main again.
- [ ] Update the adapter Git dependency/version/docs and existing pin assertions; prepare vendor through a verified wheel.
- [ ] Run adapter pytest, Node checks, Ruff and official release/Market structure validation. Commit/push normal main after another fetch.

## Task 3: Owned runtime handover and acceptance

- [ ] Recheck current ownership and stop guards. Request a normal stop and wait for native terminal/drain and process exit.
- [ ] Preserve private state, intent and original journals; refuse an uncertain handover.
- [ ] Switch only the owned independent executor to the verified runtime/backend; use the existing normal start flow.
- [ ] Confirm new leases, actual core versions, live task terminals, viewer packets and natural voice receipts. Do not equate accepted/synthesized speech with desktop playback.
- [ ] Save actual test/deployment/run evidence and update only maintenance timestamps unless completing a full health inspection.
