# Failed-plan evidence for host reflection

`agent-mc-world/review` exports `PlanReviewBook`, also available from `/client`. Each host creates one book per Agent, records real accepted `*_do`/`*_scout` replies, and feeds original `agent-mc/v1` task terminals. Correlation uses the original execution ID and runtime, retaining ordered step signatures while ignoring queue placement and JSON key order. No body connection or model is constructed.

`context(run)` retains the first failed step's bounded native diagnostic, relevant observed-effect fields and original task lookup. A successful later probe does not turn failed movement into success. Measured partial gains, changed prerequisites, cancelled/superseded work and dimension changes remain distinct. A submitted action still in flight does not occupy the priority-reflection slot. Missing effects remain unknown.

`priority(run)` exposes a current repeated failed-plan episode for the host to choose how to reason about it; it does not ban retries, cancel tasks, prescribe an escape, authorize commands or adopt a skill. The default episode window is fifteen minutes. `snapshot()` contains only bounded hashes, identities, counters and status metadata; native diagnostic text stays in memory. Hosts must not interpret a completed task, a sent use request or this projection as verified planting, delivery or learning success.

The DSH adapter may spend at most two already-scheduled requests on a new episode's priority reflection, respecting explicit human model/thinking choices and restoring its temporary override afterwards. That scheduling policy remains in the host.
