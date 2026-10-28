# Navigation repair integration

The old behavior-repair PR (#1) predates current navigation ownership, dimension
transitions and viewer provenance. Integrating its old executor wholesale would
discard those contracts. This reconciliation retains current main and adds the
missing completed-leg handoff through the existing checkpoint mechanism.

`navigateWithCheckpoints` polls while a path is pending. A completed local leg
can settle before that poll offers queued work. The new boundary offers pending
short tasks after a verified leg, then resumes the original fixed destination
under the same task identity. Water, combat, inventory readiness, foreign owners
and cancellation still use the existing checks; no automatic meal or new task
is created by this change.

The inherited regression fixture reproduced both dry-ground and water-deferral
failures on current main. It also retains a remote-arrival check. Its historical
already-near rejection was updated to test the current position-only contract:
an unsent command is explicitly reported as unsent, not silently executed or
claimed successful. This preserves the newer public help and lifecycle tests.

The integration also retains rc.117's opt-in append-only fact SDK and rc.118's
already-satisfied navigation admission guard, plus the locked shared viewer
`c0b9a7a6` with original inventory armor and first-person cave fixes.

Source integration and offline/packed acceptance do not prove live gameplay,
automatic host adoption of the fact SDK, a voice improvement or deployment.
