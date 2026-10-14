# Viewer feature integration implementation plan

> Execute sequentially in the canonical repositories; no delegated agents are needed.

**Goal:** Restore the existing shared viewer's public Agent intent, actual inputs, navigation route and movement trail, and render the same vanilla body's first-person hands and observed swings.

**Architecture:** `mc-visual-console` owns rendering, same-body protocol telemetry and browser widgets. The independent autonomy framework publishes a bounded public projection and injects it into the viewer. Neko only consumes a pinned framework package; no renderer or game policy is copied into the plugin.

**Tech stack:** Node ESM, Three.js, Minecraft 1.21.1 decoded packets, Python autonomy runtime, Node test runner and pytest.

**Spec:** User request in this task: restore animation, first-person hands, Agent commands and movement trajectories in the existing viewer.

## Constraints and review focus

- Keep the current Minecraft server, model and Neko main services running. Use the existing action account only.
- Preserve original resource bytes/model transforms. Unknown use animations remain explicitly unavailable.
- Public viewer data excludes model prompts, credentials, private memory and raw chat commands.
- Bind telemetry to player UUID, entity ID, connection epoch and runtime session; expire stale status.
- Accepted tool calls, sent input, planned route and verified task completion remain distinct.
- Clear overlays on respawn, disconnect, dimension change and teleport; release all listeners on close.

## Task 1: Restore shared native console overlays

- [ ] Add a failing same-body host/console test for live `agentVisualization` frames, real pathfinder paths, controls and movement trail.
- [ ] Reuse `createViewerAgentBridge` and `installAgentVisualization` through the native host's existing SSE connection, with no new Minecraft client or browser action channel.
- [ ] Feed renderer camera projection to the existing world-path overlay; verify original shared widgets and cleanup.
- [ ] Run relevant Node regressions and commit/push the shared repository.

## Task 2: Inject the independent framework's public Agent state

- [ ] Test bounded projection, rejected/accepted/terminal distinctions, freshness and session mismatch without network or processes.
- [ ] Publish a separate atomic public state file from runner/controller, inject its validated getter and intent into the explicit viewer adapter.
- [ ] Run full framework pytest and isolated wheel consumer checks; commit/push and pin the thin plugin.

## Task 3: Restore actual vanilla hand and swing state

- [ ] Reproduce missing main-arm/use/swing state with the vanilla presentation fixture.
- [ ] Observe the existing 1.21.1 connection's own settings/metadata and serialized arm-animation packets, without sending extra gameplay packets.
- [ ] Port the locked client's supported hand transforms and swings to the native player renderer, preserving resource/UUID checks and declaring unsupported animation families.
- [ ] Run original-asset and motion regressions plus the shared renderer suite; record the exact source/bundle hashes.

## Task 4: Deploy and verify the actual page

- [ ] Prepare pinned packages and official thin-plugin checks before touching the running owner.
- [ ] Perform one normal owned-runtime handover if required, restore the previously authorized survival goal and keep the server/model/main services continuous.
- [ ] Verify GET status, actual browser intent/route/input widgets, first/third-person switches and naturally observed movement/swing frames.
- [ ] Save screenshots and a receipt distinguishing tested, deployed, observed and unsupported behavior.
