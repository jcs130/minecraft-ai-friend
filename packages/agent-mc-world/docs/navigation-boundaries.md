# Navigation boundaries and optimization scope

## Defect and fix

A native server teleport can leave mineflayer-pathfinder 2.4.5 executing a path
and resuming an A* frontier rooted at the old location. A subsequent return
teleport can then make the old path look like an impossible jump. This is a
coordinate-frame lifecycle failure, not evidence that the destination is
unreachable or that ordinary jump limits should be relaxed.

The core now observes each native `position` packet before and after Mineflayer
applies its absolute/relative flags. A displacement of at least eight blocks in
that single packet invalidates the active physical path. Native `respawn`
invalidates it even when coordinates and dimension type are unchanged. This
does not measure elapsed walking distance, classify ordinary small corrections
as teleports, or use a chat message as world identity. Eight blocks is the
existing core's large-displacement observation threshold; it is not a claim
that every smaller displacement is physically safe.

Invalidation uses synchronous `setGoal(null)` to clear the path, frontier,
placement-return point and movement keys. It does not pause the Agent or invent
a new destination. The old `goto` receives `navigation-location-changed` with
the observed boundary; its delayed cleanup cannot cancel a replacement goal.
The Agent must read the current landing/world before deciding how to continue.
No destination is permanently blacklisted and no old movement is auto-replayed.

Bridge installs this for SDK/MCP consumers. Direct native Bot integrations may
call the public `installNavigationBoundaryGuard(bot, diagnosticLog?)` **after**
Mineflayer plugins and pathfinder have loaded. The returned disposer is
idempotent; connection end also removes the listeners. The optional
`navigationBoundaryFailureOf(bot)` is local diagnostic evidence, not a task
completion receipt. Native world names come from received login/respawn
packets, not the shared overworld dimension type.

## Upstream research and implementation choice

Sources reviewed on 2026-11-03:

| Approach | Useful property | Application here |
| --- | --- | --- |
| [Mineflayer native movement events](https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md#forcedmove) and [pathfinder events](https://github.com/PrismarineJS/mineflayer-pathfinder#events) | Explicit server relocation and path lifecycle signals | Invalidate paths on authoritative boundaries; read native position application because `forcedMove` may be delayed during respawn. |
| [D* Lite, Koenig and Likhachev](https://idm-lab.org/bib/abstracts/Koen02e.html) | Reuse search information across related navigation problems | Worth evaluating for repeated *same-world* obstacle updates. Reuse is not permission to keep an old coordinate frame after teleport. This change does not implement D* Lite. |
| [Theta*, Daniel et al.](https://idm-lab.org/bib/abstracts/Koen10r.html) | Any-angle paths reduce grid-heading constraints | Candidate for reducing zigzag on open ground, but Minecraft shortcuts also need support, body clearance, liquids and action checks. No global shortcut/jump-limit relaxation in this change. |
| [Pathfinder master human controller](https://github.com/PrismarineJS/mineflayer-pathfinder#human) | Documents sliced planning and repeated-server-setback handling | Inspected as an upstream direction; the published dependency remains 2.4.5. Master-only APIs are not assumed present or silently enabled. |

For further algorithm work, compare a fixed corpus of flat detours, partial
blocks, water exits, doors, unloaded chunks and native relocations. Report
search slice duration, nodes expanded, time to first actual displacement,
completion/failure classification and dig/place counts separately. A faster
search or accepted task alone does not demonstrate a better walk.

## Verification and limits

`tests/navigation-boundary.test.ts` runs the installed native position handler,
pathfinder and local collision physics on Java 1.21.1 and explicit 1.20.6 cases.
It includes a guard-disabled reproduction, immediate invalidation, relative
flags, small corrections, same-type world changes, fresh navigation after
landing, replacement-goal ownership and listener cleanup. Existing detour,
stairs, water, cancellation and task tests remain required.

This fixes stale path execution across relocations. It does not identify an
unmarked custom portal before entering it, prove a server portal is configured
correctly, choose the Agent's next destination, or certify every terrain route.
Live improvement requires loading the candidate and observing natural play.

For System 1/System 2 responsibilities, persistent skill integration and the
algorithm evaluation plan, see [navigation control](navigation-control.md).
