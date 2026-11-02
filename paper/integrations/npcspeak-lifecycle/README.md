# NPCSpeak / Youer entity lifecycle compatibility

This build-time patch preserves NPCSpeak's public API, existing NPC definitions and identities. It waits for persisted entities before restoring a body, resolves the current registered UUID after deferred creation, and makes fixed service NPCs silent. The shared readiness helper is compiled into this plugin's own namespace.

The separate native patch adds the existing Bukkit `persist` check to exactly `Entity.shouldBeSaved()` and `Entity.saveAsPassenger(CompoundTag)`. It does not modify `saveWithoutId`, player data, or normal persistent entities. Required input SHA256 values are pinned in `build.py`; unknown builds fail before output. No runtime Java agent or live class replacement is used.

Run `python build.py --help` for required server, JDK and new output-directory arguments. Build only against a verified copy of the installed baseline; the tool produces candidates and a receipt, never installs them. Third-party JARs, compiled output and private NPC data are not distributed in this repository.

Actual cold-start evidence, known failed fixtures, limits and deployment requirements are documented in [NPC lifecycle and CLI recovery](../../docs/NPC_CLI_LIFECYCLE_20261103.md). Both components require a normal game stop/start with current backups; do not reload them online.
