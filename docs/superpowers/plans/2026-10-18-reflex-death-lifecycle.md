# Reflex death lifecycle implementation plan

> **For agentic workers:** Execute the following checked steps sequentially in this maintenance session. The user has already authorized implementation, verification, ordinary pushes and scoped deployment; no extra handoff or delegation is needed.

**Goal:** Prevent a dead Minecraft body from restarting an environment reflex or later reporting respawn as successful rescue.

**Architecture:** Keep this guard in `agent-mc-world`'s existing Reflexes owner. Both the periodic tick and damage entry must respect Mineflayer's observed life state. The adapter only consumes a verified autonomy dependency; Neko/SDK and configured model routes remain unchanged.

**Tech Stack:** TypeScript, Mineflayer 4.37.1, Vitest fake timers and the existing 1.21.1 physics harness; Python 3.11 packaging and pinned consumers.

**Spec:** Runtime inspection found a new drowning trigger at health zero after the native death event, followed by a rescue-clear report at respawn. An unrelated DeepSeek HTTP 402 must remain an explicit account blocker, without switching models or fabricating a successful plan.

## Global constraints

- Preserve the native task queue, death cancellation and unknown-outcome protection.
- Do not modify/restart Neko main or SDK, normal models or Java servers.
- Tests use fake bodies, temporary files and no live game/model/network calls.
- Production keeps its verified rc.20 feature baseline; backport only the verified lifecycle fix into an explicit candidate source commit.
- Build and install exact source/package receipts; no tag, public release or Market submission.

## Review focus

- A zero-health body without a separate death event must not start a new rescue.
- Positive health with `isAlive:false` during respawn must not acquire control.
- Death must retire the reflex's exact escape goal and pressed controls.
- Respawn must not create a successful rescue report for the previous life.
- Fresh, alive water danger after respawn must still trigger protection normally.

### Task 1: Canonical lifecycle guard

**Files:** `packages/agent-mc-world/core/executor.ts`; `packages/agent-mc-world/tests/reflex-death-lifecycle.test.ts`.

- [x] Add fake-timer tests using `methodHarness('1.21.1')` and `Reflexes`; set water/roof geometry, zero oxygen and fixed positions. Cover all five review cases above.
- [x] Run `corepack pnpm@11.5.0 exec vitest run tests/reflex-death-lifecycle.test.ts`; retain the failing output.
- [x] Guard both tick and damage entry with `if (bot.isAlive === false || bot.health <= 0) return;`. In the death handler, retire only its current escape goal, clear controls and reset water timestamps/history.
- [x] Run targeted water/lifecycle tests, full package tests, typecheck, `build:engine` and the public packed-package checks. Commit and ordinarily push this fix to main.

### Task 2: Fixed baseline package and consumers

**Files:** the canonical autonomy `core_distribution` pin/lock/receipt and its project version; adapter project/manifest, pin tests and changelog.

- [x] Clone the local Git repository into the private inspection directory without a checkout; check out the currently deployed source revision from `core_distribution/source.json` and cherry-pick Task 1's commit. Stamp a distinct `0.5.7-rc.20.env.1` candidate version.
- [x] Verify the exact diff against that deployed source contains only the lifecycle fix/tests and version stamp. Run full package checks, pack, and test a separate installed consumer. Push the candidate source branch normally so the dependency remains fetchable.
- [x] Generate actual source/build/type/archive hashes from this package; retain the current external viewer inputs. Update the autonomy pin and dependency lock, run its full tests and isolated installed-wheel probe, then commit/push main.
- [x] Update only the adapter dependency/version and corresponding docs/tests; verify isolated vendor installation, pytest, Ruff and the official release-structure check before committing/pushing.

### Task 3: Scoped activation and evidence

- [x] Re-read Settings identity, operator stop state, owner lease and process creation times. Use a new normal mailbox stop UUID; require stopped/drained/non-uncertain state before swapping only the owned runtime packages.
- [x] Preserve every configuration field except the verified backend directory and preserve protected processes; start the same independent executor through its normal guarded CLI. Check actual loaded receipts, connection, fresh facts and browser rendering.
- [x] Observe natural activity without extra model probes or synthetic speech. If HTTP 402 persists, record planning as blocked by provider account state; a connected process is not autonomous survival success.
- [x] Append the full inspection and honest source/deployed/live verification states to maintenance logs. Keep release acceptance blocked by real deaths and unavailable planning.

## Rollout evidence

- Canonical fix: `50e9837b`; minimal rc.20 candidate: `aac8e47d`; autonomy 0.2.15 pin: `4b8fa039`; adapter 0.6.18 pin: `a58680d2`.
- Canonical core: 1,443 tests passed, two skipped; candidate baseline: 1,390 passed, two skipped; water/lifecycle selection: 36 passed. Three new regression cases failed before the fix.
- Autonomy: 1,063 passed; installed-wheel selection: 86 passed; installed Node integration: 10 passed; adapter: 369 passed. Ruff and official release-structure checks passed. No release tag or Market submission was made.
- Candidate package archive SHA256: `d9d89f9e7167dfaf13e6998d174fe2eba8e0816e6510e40a5d4b0ecfa246158a`. The running engine child and viewer wrapper use this verified package root.
- A three-minute connected observation retained the provider's HTTP 402 blocker and produced no new body tasks. No post-deployment death cycle or desktop speech playback was verified. Repeated environmental deaths and sustained survival remain open acceptance work.
