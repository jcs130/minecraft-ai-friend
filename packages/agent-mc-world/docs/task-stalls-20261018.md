# Long navigation and checkpoint meals

Base: `f00f36d4`, core 0.5.7-rc.18. The generic executor correction is shipped in 0.5.7-rc.19. Host framework code is unchanged.

## Reproduced failure

Routine food requests use `afterCheckpoint` so an acknowledged meal can briefly yield current work and then resume its original task ID. A fixed `goto` was classified as replayable, but navigation did not offer intermediate checkpoints. A long route could reserve a queued meal while continuing to move until its destination or a terminal failure. Increasing model context or reasoning does not create this missing execution boundary.

`tests/navigation-checkpoints.test.ts` reproduced the failure through the real pinned pathfinder, Prismarine physics and executor. Before the correction, six cases failed because the queued food was not consumed before arrival. The fixture records actual inventory and food changes; submitting an eat task alone is insufficient.

## Correction

During navigation, the skill offers a checkpoint to the executor. Without a pending checkpoint request it continues the same path. For a fixed `goto`, the executor may settle that path only when the player has grounded, loaded, dry, non-hazardous breathing/body cells, confirmed inventory, an empty cursor and no open container, active dig/placement, combat, environment rescue or foreign body owner.

The skill verifies ownership before withdrawing its path, awaits the old `goto` result and cleanup, and rechecks handoff conditions. A successful yield retains the original destination, step and task ID. The short task executes, produces its own actual receipt, and the original route resumes. If fresh observations invalidate a handoff, the original route can continue without replaying a completed inventory operation. It does not teleport, alter movement physics, discard goals or create a new autonomous activity.

Tests cover a meal during an unfinished route, physical arrival after resuming, single completion of the original ID, delayed cleanup, and refusal to interrupt combat, environment ownership, airborne motion, an open window or another registered goal owner.

## Model and deployment boundary

Model configuration is independent of this executor fix. A maintainer's LAN-only replay compared the same recorded scene with reasoning disabled and with `low`, and separately compared full stored history with current facts while preserving the same system prefix and seven tool schemas. Those are reconstructed requests and proposed tool choices, not captured production wire, executed game actions, or a benchmark of long-term intelligence.

The observed deployment had a 262144-token context window and requests near 100000 input tokens; a full window was not demonstrated. Repeated history, stale interpretation and no-thinking output still need separate attention. A shorter request alone is not proof of a better choice, and enabling reasoning does not fix queue scheduling.

Source, packed-consumer checks, authorized loading and live progress must be recorded separately. This correction does not itself load a production host, restart a World, change a model or prove that a live agent learned a reusable skill.
