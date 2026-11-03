### Environment
- Official Youer 1.21.1 CI build at `23f932ae111931962e2164ef1041b01d539900f9`, NeoForge 21.1.265.
- [Successful upstream run #844](https://github.com/MohistMC/Youer/actions/runs/40834104418), artifact `Youer-1.21.1-server` (ID 12879893723).
- Server JAR SHA256: `6083800040829dd1e3a12f74707e47d4227dfc2831935303f7926dfd4b0a61ba`.
- Java 21.0.12.1, Windows 11, fresh disposable flat world.
- No user mods. Only one minimal Bukkit probe plugin; no NPC, shop, or gameplay plugins.
- Control: Paper 1.21.1 build 133 / `3cb8529`, same probe and fresh-world procedure.

### Reproduction
The [complete probe source](https://github.com/jcs130/minecraft-ai-friend/blob/dc461564331950f5bfda15f9966b477e199891be/paper/integrations/youer-upstream-probe/src/YouerUpstreamProbe.java) and [Java 21 build helper](https://github.com/jcs130/minecraft-ai-friend/blob/dc461564331950f5bfda15f9966b477e199891be/paper/integrations/youer-upstream-probe/build.py) are public. Use a fresh loopback server with port 25992 (Youer) or 25994 (Paper) and a `.upstream-qa` file containing exactly `UPSTREAM_QA_ONLY`.

1. Run `upstreamprobe prepare` from the console/local RCON. It creates two ordinary, unmounted villagers in one generated chunk:
   - a control with `setPersistent(true)`;
   - a test entity with `setPersistent(false)`.
2. Both have AI/gravity disabled and are invulnerable. Their UUIDs and separate scoreboard tags are recorded. The plugin does not recreate either entity at startup.
3. Wait for `UPSTREAM_PROBE_PREP_DONE`, then stop the server normally and wait for process exit.
4. Restart the same test server normally. Run `upstreamprobe verify`, which loads the entity chunk and waits for the control entity before recording counts, UUIDs, and the persistent flag.
5. Wait for `UPSTREAM_PROBE_VERIFY_DONE`, then stop normally.

### Observed results
| Entity after restart | Youer 23f932ae | Paper control |
|---|---|---|
| Persistent control | One, same UUID, persistent=true | One, same UUID, persistent=true |
| Entity setPersistent(false) | One, same UUID, persistent=false | Absent |

Both kernels completed two normal start/stop cycles. The test entity's original UUID is restored on Youer and its persistent flag is still false; this is not a replacement spawned by the plugin.

### Expected behavior / likely cause
The entity marked nonpersistent should not be restored from chunk/entity storage after restarting. This follows the [Bukkit/Paper persistence API](https://jd.papermc.io/paper/1.21.1/org/bukkit/entity/Entity.html#setPersistent(boolean)) and the matching Paper control.

At this commit, the [native Entity patch](https://github.com/MohistMC/Youer/blob/23f932ae111931962e2164ef1041b01d539900f9/patches/net/minecraft/world/entity/Entity.java.patch) has a Bukkit persist field and serializes its value, but normal entity-saving paths still allow this nonpersistent entity to be saved. Please check the persistence guards in the normal entity/chunk save path.

This can duplicate temporary NPC/shop entities when their owning plugin creates a fresh runtime body after restart. The reproduction does not require those plugins, modify entity AI internals, or include any production world, account, or credential data.
