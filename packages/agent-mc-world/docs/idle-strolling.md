# Interruptible idle strolling

Hosts opt in with `idle.enabled: true` and `idle.allowMovement: true`.
Both remain disabled by default. The existing idle interval controls the pauses;
no extra model request or second body queue is created.

While the body is free, the controller can choose a glance, posture or local
stroll. Movement is one selection family, so adding many glance variants does
not make walking negligible. Recent actions are suppressed. A stroll covers
at most 2.4 blocks of observed dry, supported ground. Eight directions are
considered from a randomized starting direction. Repeated idle moves stay
within six blocks of the uninterrupted idle period's origin; a real activity
or relocation establishes a new origin.

The execution lease checks current hazards, nearby hostiles, body tasks,
scripts, holds, item use and containers. Terrain is checked again during
movement. New body owners cancel the idle action synchronously; late cleanup
cannot clear the successor's controls. Deliberate task navigation, including
risky terrain when authorized by the Agent, is a separate capability.

Idle movement is presentation, not a goal result. `idle-action-completed`
means the bounded action returned; actual displacement requires position
evidence. It does not prove exploration, arrival or a useful task outcome.

## Source comparison

Reviewed Touhou Little Maid's NeoForge 1.21 branch at
`207647c85740b1d0971de6040d6dd57cea62528c`:

- [MaidBrain](https://github.com/TartaricAcid/TouhouLittleMaid/blob/207647c85740b1d0971de6040d6dd57cea62528c/src/main/java/com/github/tartaricacid/touhoulittlemaid/entity/ai/brain/MaidBrain.java)
  combines low-priority looking, `RandomStroll.stroll(0.3f, 5, 3)` and
  `DoNothing(30, 60)`, gated by activity and breathing needs.
- [MaidRunOne](https://github.com/TartaricAcid/TouhouLittleMaid/blob/207647c85740b1d0971de6040d6dd57cea62528c/src/main/java/com/github/tartaricacid/touhoulittlemaid/entity/ai/brain/task/MaidRunOne.java)
  also gates selection while begging, sleeping or sitting.

The transferable idea is low-priority local variety with pauses and higher
priority activities retaining control. Server-side Java navigation and owner
teleport behavior are not copied into the Mineflayer client's body controller.

Regression coverage: `idle-wander.test.ts` and `idle-world-native.test.ts`,
including real Prismarine 1.21.1 physics, changing terrain, cancellation,
hostile arrival, script ownership, holds and cumulative drift.
