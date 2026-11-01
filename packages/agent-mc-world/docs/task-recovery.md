<!-- Owner: core/task-recovery.ts and core/skills-control.ts -->

# Measured execution recovery

Translation input lasting at least 250 ms returns `control-no-progress` when
the maximum sampled displacement stays within 0.05 blocks. The receipt retains
the measured positions and releases input ownership. It does not infer a wall,
server freeze or successful route. Rotation and neutral opposing horizontal
inputs remain valid; real excursions count even if the body later returns.

Native task reports attach bounded `agent-mc-task-recovery/v1` evidence after
two unresolved physical steps at comparable positions within two minutes.
The original execution IDs and outcomes remain authoritative. Observations,
chat, cancellation and missing position coverage cannot manufacture a failure.
A changed connection, dimension or position invalidates the comparison.

The public `TaskRecoveryBook` lets a host retaining its original body produce
the same evidence. Neither the book nor the native report selects a repair,
replays a command, declares a goal complete or starts another model loop.
