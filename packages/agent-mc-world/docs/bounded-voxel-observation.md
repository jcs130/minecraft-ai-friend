# Bounded voxel observation

This is a native client/MCP capability. It needs no Minecraft server change,
model loop, extra queue, network read or helper mod.

## Default: visible surfaces only

`mode:voxels` defaults to `format:visible`. Only line-of-sight-visible non-air
surfaces appear in `blocks:[absolute x,y,z,palette index]`. Occluded interiors
and air cells are not expanded. Invisible cells are described as **不可见**;
unloaded cells and omitted detail have separate counts. Nothing omitted is
proof of absence or safe passage. Each page checks at most 2048 positions,
near the original feet first (squared distance, y/z/x tie order), returning at
most 512 surfaces. The 24,000-character text budget can reduce this further.
`coverage` reports requested, previously scanned, scanned, remaining and
returned counts, plus invisible/unloaded/air/detail-omission counts. Optional
`next.arguments` retains the original coordinates and format; each read is fresh.
No hidden scan points, entities, air grid or `-1` entries inflate the default
result. `partial` is an observation coverage status, not an execution failure.

## Explicit dense collision view

For consumers that need each grid cell, use `format:dense`.
`observe` / `mode:voxels` accepts inclusive offsets within ±16 of the execution
feet, as before. Up to 512 cells are returned per call. Larger valid volumes are
admitted and actually read on the first call, returning `status:partial` instead
of a size rejection. Reversed/noninteger/out-of-range coordinates remain invalid;
the client never guesses a coordinate or substitutes an action.

```json
{"steps":[{"skill":"observe","mode":"voxels","format":"dense","bounds":[-5,-3,-5,5,5,5]}]}
```

This requests 1089 cells. On a simple loaded scene the first page is a contiguous
11×4×11 rectangle (484 cells), followed by 484 and 121 if the caller chooses to
continue. The cap is not a requirement to fill exactly 512 cells. Reads follow
increasing y/z/x order, x fastest, returning a rectangular prefix of the remaining
scan. Smaller targeted bounds are useful when the immediate neighborhood matters.

`bounds`, `palette`, `cells` and `unknownCells` retain their dense-page meaning.
Each response additionally includes:

- `status`, `complete`: page coverage still has remaining cells, unknown cells or
  omitted detail/entities => `partial` / false. Completing a read is never proof
  of a gameplay goal. Even a final complete page does not validate unknowns from
  earlier pages or prove the whole area safe.
- `coverage`: inclusive absolute `requestedBounds` / `returnedBounds`, original
  integer `origin`, `requestedCount`, `previouslyReturnedCount`, `returnedCount`,
  `remainingCount`, up to three disjoint `remainingRegions`, `coverageComplete`,
  page-local `observedCount` / `unknownCount`, `readAttemptedCount`,
  `unreturnedAttemptedCount`, `partialReasons` and
  `omittedEntityCount`. Returned counts include explicit unknown cells. Remaining
  regions have not been returned to the caller and remain unknown, not air.
  A text-budget preflight can sample more cells than fit in the final page;
  `unreturnedAttemptedCount` records those discarded samples explicitly. They are
  not retained across calls, and continuation reads them freshly.
  `coverageComplete` means the traversal reached the
  end; observations still retain their own times and unknowns.
- `next`: a ready-to-use `{tool:"mc_scout",arguments:{steps:[...]}}`, or null.
  Continue only if needed. The client never fetches all pages automatically.

Submit `next.arguments` unchanged; its step uses `mode:voxels,cursor` **without
bounds**. A cursor contains authenticated coordinates/offset and connection scope,
not world samples. Its original origin remains fixed when the character moves.
Each page reads the currently visible loaded world with a new `observedAt` and
current eye/frame. Pages are not an immutable same-time snapshot; changed blocks
can differ. Repeating a read cursor is a fresh read, not a replay of game actions.

Cursors are invalid after restart, reconnect, respawn, dimension change or
tampering. They fail before block reads, never silently switch to the current
feet. Start a fresh bounded query when the current scene is needed. Normal
visibility/range/unknown rules still apply even if an old origin is far away.

The 24,000-character output budget first removes entity entries with an explicit
omission count, then reduces the contiguous cell page. One pathological material
that cannot fit is represented by an unknown cell, not invented geometry or
truncated JSON. `partialReasons` records cell/text/entity budgets and unknowns.
No raw logs or world data are deleted. These output policies apply only to voxel
reads: rays/sites and probe slices retain their own limits, and write actions,
permissions, collision checks, stop/unknown barriers, timeouts and sole native
queue remain unchanged.

The registry supplies help, field descriptions and opt-in per-mode generation
alternatives from the same contract. Legacy flat provider schemas remain flat;
native validation remains authoritative.
