# Native death cancellation and respawn continuity

## Confirmed failure

During vanilla 1.21.1 play at 18:24:15 Beijing, task #16 was accepted behind combat. A Phantom killed the player one second later. The native executor cleared that queued task and the player respawned, but no terminal task event was delivered. At 18:41 the independent controller still retained its exact accepted ID, so its decisions remained at 15 while the native queue was empty. Respawn restored default health/food and cleared inventory; this was not successful food gathering or survival.

## Repair and package boundary

`Executor.cancelForDeath()` now uses the existing cancellation-report contract for each unique current, frozen, draining or queued task. Original IDs and step outcomes are retained. Accepted work that never started is explicitly cancelled, never reported completed. Existing epoch fencing blocks late old-body completions and automatic replay. The controller and thin host adapter do not acquire a second queue or infer cancellation from death text.

Native fix source: `2820afdb3d5ea0f5c995789ded24c7c27174a887`. Framework 0.1.27 pins the actual engine-only 0.4.0 archive, SHA256 `59638493deb8a111a14836a3702829f89254c83e44d80febf90e15e2eb5f46da`, plus its runtime, source and declaration manifests. The committed clean build matches the tested source/runtime snapshot. The fixed source also includes upstream game-memory roles and optional photography interfaces; no cloud image provider is configured or called in this test.

The npm lock must change the actual local tarball integrity when reusing a release-candidate version/filename. `npm install --package-lock-only` retained the previous integrity and a first dedicated install correctly failed the canonical build check. The checksum was then derived from the actual new archive, keeping all transitive pins. A fresh offline `npm ci` installation and full canonical hash verification passed. The failed install/log is retained privately and is not deployed.

## Verification

- New native regression: four failures and one pass before the fix; five passes afterward. Covers combat/external holds, queued/current/frozen tasks, duplicate death, late callbacks and new-body work without replay.
- Complete engine package: 86 files / 690 tests passed; one optional packaged-viewer test skipped without its locked assets. Existing external viewer is an explicit deployment input.
- Clean independent source build, source typecheck and build verification passed. Actual packed consumer runtime passed with network/framework imports denied; strict NodeNext and Bundler public declarations passed.
- Framework: 363 tests, Ruff, wheel build and an SDK-free isolated wheel consumer passed. Both fake autonomous and queue-only cycles preserve stop/terminal semantics with network/process launch denied.
- Live deployment and sustained survival are separate acceptance gates. No live death is intentionally triggered to test cancellation, and the old accepted task must be retired only through the owned runtime's normal disconnect, preserving original evidence.

Local proof directory: `reports/death-task-terminal-20261014/` (excluded from source delivery).

## Deployment observation

Framework 0.1.27 and thin Neko adapter 0.5.12 were installed through their normal verified dependency paths and development reload. The owned body was disconnected/restarted at 19:07–19:11 Beijing; server, model and Neko service processes stayed unchanged. Original JSON/SQLite evidence was preserved and the old accepted task retired by normal disconnect, without record deletion or replay. The original user goal was restored once through the public mailbox at 19:18:25.

The 19:13–19:21 window contains 17 connected/running samples; decisions 6→22, oak planks 4→29 and new sticks/birch logs/wooden shovel. Health ended 20/20, hunger 16/20, with no pending/uncertain task. No new server-reported death occurred, so the repaired death branch was not exercised live. The later samples remained at the same position and no food reserve, eating or shelter was confirmed: **sustained survival is not passed**. Actual world/player rendering was checked; missing Agent HUD/item textures remain separate viewer limitations. Window SHA256 `1c2e979fb90fafc396dee1581ee00b8da1356b01f883c0be7d47e0a21f59ae59`.
