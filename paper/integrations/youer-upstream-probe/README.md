# Disposable Youer/Paper compatibility probe

This probe creates two synthetic villagers and a few chunks in a fresh, disposable world. It tests the Bukkit async chunk API and `Entity.setPersistent(false)` across a normal stop/start. It has no dependency on AgentFriend, Shopkeepers, NPCSpeak, YSM, or other content mods.

Build with Java 21 against a verified server copy containing its `libraries/` directory:

```sh
python build.py --server /path/to/api-copy --jdk /path/to/jdk-21 --output /new/probe-build
```

Use an empty server folder. Install only the resulting probe JAR. Set `server-ip=127.0.0.1`, `server-port=25992` (Youer) or `25994` (Paper), use a separate local RCON port if needed, and create `.upstream-qa` containing exactly `UPSTREAM_QA_ONLY` without a newline. The plugin refuses other addresses, ports, or missing markers.

1. Start with the normal server entry point. Execute `upstreamprobe prepare` through its console or its own local RCON. Wait for `UPSTREAM_PROBE_PREP_DONE` and `plugins/YouerUpstreamProbe/prepare.properties`.
2. Stop normally and wait for the process to exit. Check the saved region location for chunk `(80,80)` is nonzero.
3. Start the same disposable server again. Execute `upstreamprobe verify`. Wait for `UPSTREAM_PROBE_VERIFY_DONE` and `verify.properties`, then stop normally.

The second phase verifies chunk `(80,80)` is both generated and unloaded before testing `getChunkAtAsync(..., false)`. That positive precondition matters: same-tick save/unload is not proof that a newly generated chunk has reached disk.

Expected results: the loaded-chunk control returns a chunk; a request with `generate=true` creates a new chunk; the saved unloaded chunk returns a chunk; the ordinary persistent villager retains its UUID; the `setPersistent(false)` villager is absent after restart. The UUIDs in these files belong only to the synthetic fixtures.

Do not install this probe on a production world. It is a reproducer, not a compatibility patch. See [the upstream audit](../../docs/YOUER_UPSTREAM_20261103.md) for the actual channel, artifact hashes, observed results, and open issues.
