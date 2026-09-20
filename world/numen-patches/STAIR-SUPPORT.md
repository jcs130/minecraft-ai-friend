# Stair support overlay for the installed Numen 0.1.3 fork

`stair-support-v1.patch` removes `STAIRS` from `CellClass.canWalkThrough`'s
always-passable cases. `canWalkOn` is unchanged. The planner continues to use
the air cell above a stair as its normalized feet position, as
`Movement.feet` already does for stairs and slabs.

Before this change, `MovementDownward.cost` could price a downward edge into
the stair itself at zero mining cost, even with alteration disabled. Native
archive descent logs reproduced repeated `MovementDownward` `UNREACHABLE`
segments; the mine entrance also stalled at the high half of a descending
stair. The change rejects this false edge. It adds no digging, placing,
teleporting, body restoration, or task dispatch behavior.

The exact parent is SHA-256
`9591136eea7eb68e7914e31c8627474a1925c11eb675f076e209620afcd9508d`.
Historical upstream release/0.1.1 manifests are not a substitute for that
installed fork. The builder verifies the whole parent, the original class,
the checked-in source and patch, then recompiles the original source and
compares its disassembly with the parent before creating an overlay.
Only the `CellClass` family may change; every other JAR entry is verified
byte-for-byte after overlay. Runtime output stays ignored.

From the project root, using the installed libraries without installing
dependencies or starting a server:

```powershell
.\run-python.bat -X utf8 tools/build_numen_stair_support.py --baseline-jar D:/path/numen-neoforge-1.21.1-0.1.3.jar --libraries D:/Projects/QiandengJi/server/mc/libraries
.\run-python.bat -X utf8 -m unittest tests.test_numen_stair_support_build -v
```

The builder uses `--release 21`; `--jdk-bin` can select a local JDK. It runs
the same Java test against both parent and candidate. The parent must fail
the stair-body-cell assertion; the candidate must pass at least 200 native
classification/movement-cost assertions, including all four stair facings,
both halves, all stair shapes, ascent/descent, a normal one-block descent,
air passage, and refusal to dig solid support. These use actual mapped MC
1.21.1 states and Numen methods in a frozen `BlockGetter`, with break/place
disabled. Headless registry bootstrap uses vanilla mapped MC classes; this
does not replace NeoForge server linkage or physical navigation testing.

Inspect `runtime/numen-stair-support-build/latest.json` and its adjacent
logs/disassembly. The build record always says `livePhysicsVerified: false`:
native warehouse and mine descent, bridge ascent, normal ground movement,
and terminal task outcomes require separate QA with the installed candidate.
Building this overlay never installs it or issues game commands.

## Native QA, 2026-09-20

Candidate SHA-256
`5e913b2ffb1a39b199333f768526537867be726bf27c451e7a1a507cc8a35da0`
was tested in the isolated NeoForge server with the rebuilt Bridge
`361636f64e201bbf5cd11cf9963d9051d2a9562c1e3d157c804782f6a897af4a`.
The original QA body UUID was restored; each traversal used only a starting
teleport, followed by native movement with `spec: {alter: "none", alter_budget: 0}`.
No mid-route teleport, digging, placing, or geometry repair was used.

The installed 0.1.3 API differs from historical patches: `goto` accepts
`spec`, not `walk_only`; alteration already defaults to `NONE`.
`get_self_status` has neither `navigation_epoch` nor
`last_navigation_result`, and `task_status` exposes only the current task.
For QA, a temporary observer retained the actual native `TaskRecord` and
read its public state/result getters after settlement, matching the accepted
task ID and the observer's boot epoch. That epoch is **not** a native
navigation epoch. The observer did not modify tasks or results and was not
added to production. Physical arrival was checked separately: native
`SUCCESS` can describe an explicit near-goal fallback.

| Trial | Native result and physical acceptance | Seconds | Final distance |
| --- | --- | ---: | ---: |
| Warehouse descent | Exact-cell SUCCESS, passed | 4.283 | 0.269 |
| Warehouse ascent | Exact-cell SUCCESS, passed | 4.169 | 0.142 |
| Mine descent, immediate after starting TP | Near-goal SUCCESS, **failed** physical acceptance | 11.410 | 4.188 |
| Mine ascent | Exact-cell SUCCESS, passed | 12.575 | 0.404 |
| Bridge and ascending bank stairs | Exact-cell SUCCESS, passed | 6.382 | 0.702 |
| Mine descent, start stabilized for 12 actual ticks | Exact-cell SUCCESS, passed | 12.532 | 0.166 |

The first mine result remains a failed trial; it is not replaced by the later
pass. Its exact search failed immediately after a long starting teleport;
Numen's own fallback then stopped at Y=32 instead of the requested Y=29.
The single separately authorized diagnostic trial kept the same start,
target, JAR, and route specification, but observed 12 advancing game ticks
and zero starting-position drift before dispatch. It reached
`(-766.652293, 29, 785.434365)`; a later idle observation confirmed
`on_ground=true`, outside water, at that same position.

Current source and deployed bytecode show that `PathCaches.ensureSnapshot`
returns any existing level snapshot without checking its requested center;
the snapshot covers an eight-chunk radius and is rebuilt in the core's
server Post tick, while task dispatch runs in Pre. This is consistent with
the immediate-after-teleport failure and the stabilized pass, but the test
does not independently prove that cache timing was the sole cause. No cache
behavior or native fallback semantics were changed by this overlay.

Local raw evidence is under
`runtime/town-rebuild-20260920/qa/navigation-*-stair-v1*.jsonl`, with the
five-trial summary and retained server logs in `qa/nav-recorder/`.
The explicit native call schema comes from `MoveToTool.Args` and
`RouteSpecJson`; historical `walk-only-v1` interfaces must not be used as
the installed 0.1.3 contract.

For deployment provenance, existing `world_interaction_health.py` and
`navigation_sense_health.py` read the canonical dependency name
`numen-neoforge-1.21.1-0.1.3.jar` from the Bridge build record and compare its
hash with the installed file. Rebuild the Bridge using that basename and
the new candidate as its dependency; do not relax the probes or replace
old 0.1.1 expectations to manufacture a healthy result.
