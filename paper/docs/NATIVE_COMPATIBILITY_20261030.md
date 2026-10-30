# 2026-10-30 Youer compatibility repair

This release keeps the current Youer 1.21.1 kernel and native maid mods. It does
not install the separate six-stage Aincrad candidate or change player progress.
Deployment status is recorded in `../manifests/current-deployment.json`; source
availability and isolated test success do not by themselves mean deployment.

## AgentVision 0.1.4

The original 0.1.3 binary invokes Paper's Moonrise chunk-loader API. That method
does not exist on the current Youer kernel. The periodic visibility task throws
`NoSuchMethodError` every tick, while event-driven decisions can still run.

`NativeTracking` resolves the platform once before installing the filter. Paper
uses its existing chunk-sent API; Youer uses the native ChunkMap tracking view
and pending chunk-send state. Reflection handles are cached. The existing
same-world, chunk readiness, range and collision-shape visibility rules remain.
Spatial hiding does not remove player identities from the tab roster. An
unexpected tracking failure stops the periodic task and reports once instead
of creating a new exception every tick.

Actual independent Paper and Youer clients each passed 17 checks: stone
occlusion, glass and partial fences, repeated hide/reveal, roster stability,
death/respawn and continued queue processing. These tests do not implement the
separately requested coarse hearing/Ranger perception enhancement.

Build with `paper/ops/build-agent-vision-platform.py`, supplying the existing
server tree, mapped Paper jar, JDK 21 and a new output directory. The builder
pins its baseline binary and preserves existing resources. Production retains
the historical `AgentVision-0.1.2.jar` filename; metadata identifies 0.1.4.
The runtime explicitly refuses loading Paper plugins during operation, so the
binary requires a normal stop/start.

## Login protocol route

The native backend is protocol 767 (1.21.1). The proxy had explicitly pinned it
to 766 (1.20.6), causing even native 1.21.1 sessions to enter an unnecessary
translation path. The observed login error was in UPDATE_RECIPES rewriting.
Only `velocity-servers.paper` changes to 767. The separate auth/default routes
remain 766; authentication and client protocol checks remain enabled.

An isolated relay using the production kernel and translators passed real
1.20.6, 1.21.1 and 1.21.4 client logins. The originally failing remote modded
client still needs an actual post-deployment retest.

## Minepacks standard menus

Minepacks 2.5.9's Paper-specific title helper reflects menu constants that are
absent on Youer. It then encodes an open-screen packet with a null menu type.

This exact binary reads **`Database.UseDynamicTitle`**, although its bundled
configuration documents a root-level `UseDynamicTitle` key. Set **both to
false**, merging the nested key into the existing Database section without
replacing its storage settings. Setting only the root key is insufficient.
The overlay is `paper/config/Minepacks/backpack-overrides.yml`.

The standard Bukkit menu retains the original 54 slots and database. No
backpack is cleared, resized or replaced. The isolated test requires the exact
production Minepacks binary, the same Chinese shortcut name, repeated actual
right clicks, server-side inventory receipts and a reconnect persistence check.

## Compass target

Youer can return a null compass target after a world or respawn transition.
`syncCompass` now handles null target/world values and keeps an existing valid
original target. The narrow AF 0.4.47.36-compat binary replaces this method only:
275 other methods and 598 unrelated jar entries are preserved. The console-only
loopback fixture verifies four cases without changing an actual player or world.
`paper/ops/patches/CompassMethodPatch.java` performs the method replacement.
`paper/ops/build-compass-compat.py` rebuilds it against the pinned baseline and
runtime libraries. Its independent rebuild matches the frozen artifact exactly.

## Reported maid-death disconnect

The reported timing is the death instant. A captured LittleFish disconnect has
the same null-menu open-screen error, but the precise report time is still
unconfirmed. Isolated vanilla villager and native maid death checks separately
exercise death packets and the native tombstone. They must not be used as proof
that the original remote modded client already passes. Existing maids, inventory
and tombstones are not removed or resurrected to conceal the problem.

## Operations

Normal restart of game and login/model proxy was approved. Maintenance still
requires the actual human/activity checks, countdown and verified current game
and authentication cold copies on E/F. The original native maid bridge 0.1.5 is
already staged and is expected to load during this restart. Keep the kernel,
mods, credentials, RPG records, protection and six-stage candidate boundaries.
Do not run an older consumed maintenance launcher.

An independent LightAntiCheat movement event also attempted a teleport from an
asynchronous thread. It is recorded separately and is not fixed by this release.
