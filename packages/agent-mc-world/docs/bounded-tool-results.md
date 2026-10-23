# Bounded observations and trustworthy receipts (rc.77)

This is a **Mineflayer client / SDK / MCP execution change**. It does not install a
server mod, change permissions, remove collisions, restart a game, or start a model.
Java 1.21.1 is the primary target; existing 1.20.6 geometry/action tests remain.
Other body providers advertise their own capabilities: this does not claim Numen
or the Java-client provider has gained an unimplemented observation API.

## Before / after

| Call | Previous behavior | Current behavior |
| --- | --- | --- |
| `mc_scout` observe voxels, `[-10,0,-10,10,4,10]` (2205 cells) | Reject the whole batch, give an example, read nothing | Admit normally; one bounded, real observation in the existing task result |
| `mc_observe` with those bounds | Unavailable | Immediate read: normal `data.status=partial`, at most 512 cells; no queue mutation |
| Damaged/missing/conflicting parameters | Often a string plus help | `invalid_arguments`, field path, expected contract, actual problem, minimal legal example; no dispatch |
| Known crop/container/path/protection outcome | Primarily prose | Preserve original task verdict/effects; add a structured step decision and safe read/continue condition |
| Lost request outcome | Error warning against replay | Same durable deduplication plus read-only lookup by the original request ID |

Immediate call (MCP arguments; SDK uses `client.call('mc_observe', arguments)`):

```json
{"mode":"voxels","bounds":[-10,0,-10,10,4,10]}
```

`mode` is required. Initial voxel bounds are six integer **block offsets**, inclusive,
relative to `floor(feet)` when the read executes, each between -16 and 16.
Omitting bounds uses `[-1,-1,-1,1,2,1]`. `sites` requires 1–4 absolute integer triples.
`rays` uses relative pitch/yaw degrees and range in blocks; its defaults and limits
are in the same `SPATIAL_QUERY_SCHEMA` used for tool discovery and skill fields.
`mc_tool_help` exposes the complete effective schema. `mc_help skill:observe`
includes the same voxel budget, algorithm and return contract.

The live isolated 1.21.1 test merged rc.77 read at anchor `[0,-60,0]` returned this envelope
(large `palette` and `cells` arrays omitted **only from this document**):

```json
{
  "status": "partial",
  "requested_bounds": [
    -10,
    -60,
    -10,
    10,
    -56,
    10
  ],
  "requested_count": 2205,
  "returned_regions": [
    [
      -10,
      -60,
      -10,
      10,
      -60,
      10
    ]
  ],
  "returned_count": 441,
  "observed_count": 438,
  "unknownCells": 3,
  "remaining_count": 1764,
  "remaining_after_page": 1764,
  "complete": false,
  "partial_reason": "cell_budget+unknown_cells",
  "coordinate_system": "absolute_block",
  "units": "blocks",
  "query_anchor": [
    0,
    -60,
    0
  ],
  "observed_at": "2026-10-23T12:08:35.914Z",
  "retryable": false,
  "retry_after": null
}
```

## Coverage and continuation

- Dense selection follows the upstream contiguous rectangular prefix in y,z,x
  order, x fastest. Do not reshape a region just to fill 512 cells. `mc_observe`
  defaults to dense; queued observe follows upstream's visible-surface default.
  Visible mode checks at most 2048 anchor-near cells and reports at most 512
  non-air surfaces, retaining invisible/unloaded/air counts. Explicitly request
  `format:dense` when existing code needs `cells` and a contiguous grid.
- The returned `bounds` and each `returned_regions` entry use **absolute** integer
  cells, inclusive. `cells` is y,z,x order, x fastest; its length equals
  `returned_count` and the cuboid volume. Unknown cells are included in that count.
- `remaining_count` means outside **this page**, including earlier pages if any.
  `remaining_after_page` is the disjoint volume left in `next_cursor`.
  `observed_count` excludes unknowns; `unobserved_count` includes both omitted and
  unknown cells. `complete_scope` explicitly retains the upstream meaning: scan exhausted and
  this page readable; earlier pages are not refreshed. Step decision counters use
  this response's actual observations, and do not infer host goal completion.
- `next_cursor` is the upstream opaque signed string, binding the original
  anchor, dimension, connection and respawn scope, format and scan offset. Send it unchanged with
  `{"mode":"voxels","cursor":...}`, or use the returned `next_safe_read` arguments.
  Do not send bounds together with a cursor. Only the Agent decides whether to
  continue; nothing automatically drains the rest.
- Movement cannot move a cursor's coordinates. Each page rechecks **current**
  visibility/loading and has its own `observed_at`; pages are not a snapshot.
  Dimension, respawn or connection changes block the read rather than reanchoring it.
- A response is bounded to 24000 UTF-16 characters. Unusually verbose mod geometry
  further reduces the page; a material too large even for one cell stays unknown.
  Reads already performed are cached within this call; the fallback never reads
  outside its original at-most-512-cell candidate. No partial JSON is emitted.

`-1`, null geometry, omitted cells and failed reads stay **unknown**. They cannot
establish air, absence, safety, support, permission or a traversable route.
Voxel entity data has a separate 512-entry limit and explicit `omitted_entities`.

## Seeing and moving are different

The existing occlusion gate remains. Ordinary/stained glass and glass panes allow
optical observation of the world behind them, while their real collision boxes
remain. Tinted glass remains opaque. `palette[].vision` is `transparent`,
`shape-dependent`, or `unknown`; it never grants passage. Collision rays deliberately
hit glass. Use `sites[].body.clear` for the 0.6×1.8 body test and actual geometry for
navigation; neither establishes permissions, support or complete route safety.
Block observation is an occlusion test, **not a pixel-exact camera/FOV simulation**.

This client-side information boundary cannot prevent an owner from modifying its
client or reading raw received chunks. It also does not reduce bytes already sent
from the game server. Upstream approaches have different purposes:

- [Mineflayer settings](https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md):
  request a smaller chunk radius. The core accepts optional `viewDistance:2..32`
  in chunks and passes it into `createBot`; omitted preserves the upstream default.
  The server may cap/ignore it. This is bandwidth tuning, not anti-xray.
- [Paper Anti-Xray](https://docs.papermc.io/paper/anti-xray/): server-side block
  obfuscation. It is not a general line-of-sight delivery protocol.
- [RayTraceAntiXray](https://github.com/stonar96/RayTraceAntiXray): a Paper add-on
  using ray tracing to hide exposed ores and supported block entities. Its own
  documentation notes resource costs and conservative visibility. It is not a
  NeoForge drop-in.
- [DrexHD AntiXray](https://github.com/DrexHD/AntiXray): investigate its matching
  loader/game release for a modded server; do not install a latest jar merely
  because NeoForge support exists. Mod ores/containers and the native-to-Mineflayer
  gateway need independent registry and reveal/update tests.

No server-side anti-xray was installed or claimed verified in this change.

## Business outcomes, API errors and unknown effects

MCP immediate data is in `structuredContent.data` (also JSON in text).
Parameter errors are MCP `isError:true` and `status:invalid_arguments`:
`errors[]` gives path/expected/problem, with actual values for semantic diagnostics.
A minimal example is a **reference**, never an edited/resubmitted action.
The shared registry supplies skill schemas, field diagnostics and examples.
Safe existing normalizations (complete JSON-array decoding in SDK, explicit
single-block placement forms) keep their notes. `to` is never renamed to `at`;
unknown targets, reversed bounds and conflicting alternatives are not guessed.
Malformed scalar controls are rejected consistently in SDK parsing too: for example,
`dryRun:"true"` cannot turn into a real write and `count:1.9` is not rounded down.
Safe accepted whitespace trimming is reported in normalization notes.

Normal pre-dispatch gameplay refusals have `data.status:blocked`, actual zero
dispatch, and a reason/safe read. Legacy `failed` remains for SDK compatibility;
MCP does not turn a recognized gameplay block into an API `isError`. Genuine RPC
cancellation keeps its previous error behavior, with unknown effect reconciliation.

Queued task results retain `outcome`, original text and `observedEffect`. Each step
also has `decision`: status, reason, completed/remaining (null if unknown), unit,
retryable, retry_after (**milliseconds**, null if unknown), continue_when and
next_safe_read. Counts are reported only from actual progress/readback. Crop
readiness, full destination, no path, protection denial and uncertain inventory
sync have explicit conditions. Unknown transfers do not become successful because
an interaction packet was sent. This does not add an automatic retry policy.

For queued `observe`, full JSON survives in
`execution.evidence.steps[].observation`, including cells, coverage and cursor;
the short human detail preview is not the full data. Task execution completion
still has `goalCompleted:false`; reading one partial page is not goal completion.
Existing queue modes, stop/timeout behavior, write budgets and authorization remain.

Use a stable caller-owned request ID in MCP `_meta["agent-mc/v1"].requestId` or SDK
call options. Reconcile after interruption with:

```json
{"protocol":"agent-mc/v1","action":"request","id":"original-request-id"}
```

SDK: `client.request('original-request-id')`, also available while disconnected.
The durable ledger returns a recorded outcome or `status:unknown`, including
not-found, pending/interrupted and failed transport. This query never dispatches
an action. A returned acceptance receipt is still only acceptance. Same-ID
resubmission is deduplicated; changing arguments under that ID is rejected.
Do not issue a new request ID to replay an uncertain side effect.

## Regression and live evidence

`bounded-observation*.test.ts` uses the real native block registry/physics and actual
MCP transport: overbudget data, counters, exact disjoint coverage, fixed cursor
after movement, signed cursor scope/tampering, timestamps, malformed/conflicting input, visibility/unknowns,
glass vs collision, response-budget fallback, legacy task evidence, queue retention,
API vs business results and request deduplication. The inventory test independently
checks source/destination/cursor changes against the claimed partial amount.
Existing permissions, write caps, cancel, timeout, turn, IPC and queue suites run too.

Live isolated NeoForge 1.21.1 + native Mineflayer gateway: 2205 requested → 441
returned, 438 observed + 3 unknown; all 438 names/state IDs independently matched
the connected world's cell reads. A second explicit page retained absolute bounds
and anchor, with timestamp `2026-10-23T12:08:37.065Z`. Two reads total; zero model
calls, no construction/digging/inventory mutations. Test services shut down normally
with exit code 0. Private raw receipts/logs remain outside the repository.

Compatibility: the upstream visible-surface API and signed cursors are retained. Dense-grid consumers must select `format:"dense"` on queued observe; immediate `mc_observe` does this by default. The added root envelope aliases coexist with upstream `coverage` and `next`.
