# Building, cleanup and editable methods

## Build with a purpose

Choose the intended use, scale, entrances and circulation before adding blocks. Treat proportion, a main/secondary palette, facade depth, roof outline and fit with the surroundings as choices to evaluate. A flat roof, asymmetry or a single material is not automatically bad.

`mc_blueprint` compilation returns bounded design measurements and known low-headroom locations. These describe the design, not the world or its aesthetic quality. `structure_void`, partial support shapes and unloaded terrain require live observations. Use `observe sites`, voxels or rays for floor height, headroom, collision and approach; use images for visible appearance. Keep blueprint origin separate from the working position. Verify final blocks, access and views before declaring completion.

## Temporary supports

The engine records pathfinding supports using before/send/confirmed placement evidence. Explicit authored supports use ordinary `build` with `temporary:true`, for example:

```json
{"steps":[{"skill":"build","material":"dirt","anchors":[[103,64,-31]],"temporary":true}]}
```

Coordinates above are examples, not a route. Observe the actual site first. Existing blocks are never claimed as temporary by this call. Blueprint builds remain permanent. Ordinary permanent builds promote any proven temporary blocks in the intended work, including already-matching cells.

After using a support, move to stable ground and submit `cleanup`. `cleanup dryRun:true` only reads. Safe movement/collection/construction boundaries also attempt bounded cleanup. The temporary build itself does not immediately undo its work. Never delete a support under an entity, attached work, retained structure or liquid boundary. A retained block is unfinished cleanup, with a reason in fresh `temporaryScaffolds` facts and script state. Reach/visibility/permissions are rechecked before digging. These facts are replaced after cleanup.

Cleanup provenance belongs to the current connection. Unload, replacement or reconnect invalidates automatic cleanup authority. An empty ledger is not evidence that every old site is clean. A fresh Agent process cannot infer ownership from dirt or an old coordinate alone; historical obligations can be saved in scoped game memory as unverified notes.

## Edit a method, then establish evidence

1. `mc_script {"library":{"op":"list","query":"purpose","limit":8}}` searches names/descriptions/conditions. Use the returned cursor as `after` for another page. Read only an applicable method with `{"library":{"op":"read","id":"method-id"}}`.
2. Inspect a failure's complete `runId` / `call` result and current geometry. Separate wrong assumptions from native execution defects. State a proposed change and conditions.
3. Edit your own bounded JavaScript method. `{"name":"method-id","code":"…","validate":true}` checks syntax without movement. Read `runId` until `validated`; syntax validation alone does not test APIs or prove success.
4. Save with `library:{op:"save",id,code,description,conditions,parent,validationRunId}`. For a new name, `parent:null`; for a revision, use the exact latest revision. Conflicts require rereading and merging. Author, time, source hash and parent are preserved. Sources are immutable; saving does not execute or install them.
5. Execute `mc_script {"procedure": <returned reference>}` in an appropriate natural scene. All SDK calls return Promises. Await actual executor terminals and expand the full result before judging it. Compare relevant position, blocks, health or inventory before/after; admission, a finished program or speech is not net progress.
6. Save evidence and failure boundaries with the version in scoped game memory or host memory. Retrieve them at the next comparable scene. Explicitly select the retained version; use an old reference to roll back. A maintenance-authored repair is not autonomous learning.

The library lives in the configured data directory, isolated by server and Agent account. `persistent:false` means memory only. Limits: 128 method names, 64 immutable versions per name, 20 summaries per list page, 12,000 source characters. A storage error is reported; do not interpret it as a save. Engine restarts may discard run IDs, so validate again before saving. This does not permit methods to change core engine files, host configuration, network access, permissions or body ownership.

## Route failures

The executable ground path is checked after waypoint adjustment. An unplanned rise beyond the ordinary jump envelope returns the measured edge and a path-geometry error before movement. Planned placement/digging, climb/water, jump/levitation effects and unknown geometry need their own execution checks; the guard is not a complete reachability proof. Inspect actual support and clearance before selecting a new route. Do not retry an unchanged invalid path or record a local failure as proof that the destination is permanently inaccessible.
