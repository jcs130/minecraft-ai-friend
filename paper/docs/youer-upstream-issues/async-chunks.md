### Environment
- Official Youer 1.21.1 CI build at `23f932ae111931962e2164ef1041b01d539900f9`, NeoForge 21.1.265.
- [Successful upstream run #844](https://github.com/MohistMC/Youer/actions/runs/40834104418), artifact `Youer-1.21.1-server` (ID 12879893723).
- Server JAR SHA256: `6083800040829dd1e3a12f74707e47d4227dfc2831935303f7926dfd4b0a61ba`.
- Java 21.0.12.1, Windows 11, fresh disposable flat world.
- No user mods. Only one minimal Bukkit probe plugin; no gameplay plugins.
- Control: Paper 1.21.1 build 133 / `3cb8529`, same probe and fresh-world procedure.

### Reproduction
The [complete probe source](https://github.com/jcs130/minecraft-ai-friend/blob/dc461564331950f5bfda15f9966b477e199891be/paper/integrations/youer-upstream-probe/src/YouerUpstreamProbe.java) and [Java 21 build helper](https://github.com/jcs130/minecraft-ai-friend/blob/dc461564331950f5bfda15f9966b477e199891be/paper/integrations/youer-upstream-probe/build.py) are public. The probe deliberately requires a disposable loopback server, port 25992 (Youer) or 25994 (Paper), and a `.upstream-qa` file containing exactly `UPSTREAM_QA_ONLY`.

1. In the empty test world, run `upstreamprobe prepare` from the console/local RCON and wait for `UPSTREAM_PROBE_PREP_DONE`.
2. This requests a loaded chunk with `getChunkAtAsync(0, 0, false)`, then requests a previously ungenerated chunk with `getChunkAtAsync(96, 96, true)`.
3. It also generates chunk (80,80) and keeps it loaded. Stop normally and wait for all saves/process exit. Confirm that chunk's region location is nonzero.
4. Restart normally, then run `upstreamprobe verify`. Before calling `getChunkAtAsync(80, 80, false)`, the probe explicitly verifies `isChunkGenerated == true` and `isChunkLoaded == false`.
5. Wait for `UPSTREAM_PROBE_VERIFY_DONE`, then stop normally.

The restart and on-disk positive preconditions avoid conflating a pending save with an existing saved chunk.

### Observed results
| Case | Youer 23f932ae | Paper control |
|---|---|---|
| Already-loaded chunk, generate=false | Non-null chunk | Non-null chunk |
| New chunk, generate=true | Future completes normally with null; chunk remains ungenerated | Non-null chunk; generated |
| Saved unloaded chunk after restart, generate=false | Future completes normally with null; chunk remains unloaded | Non-null chunk; loaded |

The saved-chunk request completed in 37 ms on Youer, with no exception. This is an incorrect terminal result rather than a future timeout. Both servers completed two normal start/stop cycles.

### Expected behavior / likely cause
The async API should load an already-generated chunk, and honor `generate=true` for an ungenerated chunk, consistently with the [Paper API contract](https://jd.papermc.io/paper/1.21.1/org/bukkit/World.html#getChunkAtAsync(int,int,boolean)).

At the tested commit, [CraftWorld.getChunkAtAsync](https://github.com/MohistMC/Youer/blob/23f932ae111931962e2164ef1041b01d539900f9/src/main/java/org/bukkit/craftbukkit/CraftWorld.java#L2405) only looks up an already-loaded chunk in its main-thread callback. It does not initiate a load/generation operation and does not use the gen/urgent arguments there.

This breaks plugins performing safe async teleport preparation into saved but currently unloaded areas. No production world, account data, or credentials are included in this reproducer.
