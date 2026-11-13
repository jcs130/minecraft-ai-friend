# Native NeoForge client boundary

This opt-in companion targets Minecraft Java 1.21.1 / NeoForge 21.1.252 and the
original YSM 2.6.5 NeoForge release. It does not install a Fabric loader, Connector,
Cortico framework, agent host, model loop or server bridge.

The existing core-owned login, reconnect, scope, initial perspective, appearance
policy and explicit graphics-library hook are compiled from their canonical Java
sources. `client-source-mappings.mjs` deterministically translates their 1.21.1
intermediary identifiers to Mojang names using an explicitly supplied matching
Tiny mapping. It rejects missing/ambiguous names and surviving Fabric imports.
NeoForge lifecycle, registry codecs and the original YSM attachment/HUD contracts
are native maintained sources here. Source and mapping hashes accompany each build.
The legacy login class/config names remain migration compatibility identifiers.

Build with JDK 21 and explicit local inputs:

```
node scripts/build-client-neoforge.mjs --game-dir <installed-client> --java-home <JDK21> --mappings <1.21.1-tiny> --output-dir <private-build-dir>
```

Only this companion and matching original third-party JARs go in the NeoForge
profile. Never copy Fabric mod JARs. The builder checks the original YSM SHA and
ASM hook contracts and runs the shared policies. It does not launch a game,
connect, download models or modify a production profile.

`org.agentmc.platform.ClientRuntime` exposes lifecycle, system chat, tick,
key-registration, HUD/world-render and optional PLAY-payload registration hooks
to separate client consumers. Receivers are scoped to the actual connection,
invalidated before disconnect callbacks and rechecked after main-thread enqueue.
Consumers cannot silently replace a codec or receive a retired connection's data.
The visual console depends on this boundary; this package does not import it.

Login requires an explicit exact server/account config and local credential file;
appearance overrides require explicit bindings (an empty list retains server
selection). Credentials are never build inputs. Private binaries, captures,
configuration and account-specific deployment data stay outside this package.

For the optional Windows Mesa path, retain a private matching GLFW/GL distribution,
set `GALLIUM_DRIVER=d3d12` before launch, and disable NeoForge's early window with
`earlyWindowControl=false`. The core hook selects only the explicitly configured
GL library before the first game window. Neither GPU selection nor rendering
success is implied by a successful build; check the actual renderer and pixels.

Source build, packaged checks, installation and live model/game rendering are
separate acceptance stages. The original YSM/maid mods and their assets are not
rewritten or bundled by this companion.
