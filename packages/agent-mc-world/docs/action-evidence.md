# Action identity and position-change evidence

`TaskReport.steps` retains `skill` and `what` for completed and cancelled
execution. A step number identifies ordering only. It cannot identify whether a
partial result is a navigation attempt, a read-only voxel scan, or crafting.
Hosts should retain these fields when summarizing native results.

`compactWorkExecutionEvidence` keeps the bounded action description, target,
before/after positions and observation timestamps. Bulk inventory and voxel
arrays remain in the source record. The continuation fingerprint excludes only
sampling clocks from these typed fields: another sample of unchanged facts
does not renew a task's progress budget. Targets, positions, result status,
unknown coverage and domain revisions still distinguish changed evidence.

Native `forcedMove` is a received position correction, not an actor attribution.
Material changes emit `meta.positionChange` with before/after coordinates and
`cause: null`, `initiator: null`. Correlate an issued action and its actual server
receipt before describing a self-initiated or externally initiated teleport.
Existing connection, death and navigation invalidation rules remain intact.

Route probe text explicitly describes unexecuted planned waypoints. A complete
probe does not prove arrival; verify native execution and actual position.

The public gameplay-memory projection preserves these distinctions. Observation
coverage is never item acquisition or goal completion. Host-specific attribution
can attach the exact issued call and assignment while retaining source/world/run
identity. Recalling that historical record does not make it current world state.
