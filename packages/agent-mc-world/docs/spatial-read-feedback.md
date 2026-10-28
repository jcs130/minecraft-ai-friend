# Current spatial read feedback

Immediate observations expose `data.readout` and `meta.observation` using `agent-mc-spatial-read/v1`. Queued spatial observations retain the same readout inside their original data. The readout appears before dense geometry so bounded model views can distinguish an exhausted scan from incomplete visibility.

- `scanComplete` concerns requested scan coverage; `knownComplete` concerns the returned observations. An exhausted scan with 39 unknown cells is neither an in-flight action nor an unfinished next page.
- Unknown dense cells and unavailable visible surfaces keep their original meanings. No hidden terrain, automatic movement, retry, page fetch or goal completion is introduced.
- `selection` identifies the observed region and connection-local frame; `revision` hashes original measured content with only sampling timestamps and opaque continuation handles omitted. Coordinates, numeric block states, counts and geometry remain significant. These hashes are sample evidence, not proof that the world has stayed unchanged since the read.
- Missing counts remain `null`. Original data, cells, material properties, continuation coordinates and query limits remain available. The existing 24,000-character page limit includes the new prefix.

The SDK exports `spatialReadout` and `SpatialReadout` from `agent-mc-world/client`. Hosts may use repeated typed samples when deciding whether an existing request needs more reasoning. The core never calls a model or adopts a skill, and repeated reads never authorize cancelling native work or replaying an unknown action.

A host presenting both `text` and `data` should recognize an exact JSON duplicate and show one structured copy. Preserve native control and typed feedback ahead of potentially capped geometry; retain the complete original receipt and its historical lookup. Do not classify repeated observations by removing every number: that would erase actual position and block-state changes.
