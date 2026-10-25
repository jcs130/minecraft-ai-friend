# Viewer resources and game startup

The modern vanilla viewer's “画质与特效” menu separately controls particles/hit bursts, visual sound/status/skill cues, rain and dynamic shadows. Disabling disposes existing affected effects and prevents new allocations; it does not mute audio, change gameplay, or hide health/status HUD. Browser-origin preferences apply immediately and persist for subsequent visits at that origin. Every shipped version must carry a rebuilt bundle for these controls.

Identical PNG bytes from vanilla versions share SHA-256 objects in the packaged runtime, with version-specific aliases. Different bytes and numeric registries stay separate. Player skins default to the vanilla textures properties actually delivered on this connection, including slim metadata and late player-info updates. Local own-player overrides retain priority; absent server properties leave default appearance. Explicit `remoteTextures:false` disables official texture fetching without disabling terrain.

There is no game-version whitelist. The shipped picture packs are defaults, not a protocol support list. `mc_connection action:"viewer-status"` returns the actual version, selected root and [on-demand preparation guide](https://github.com/jcs130/mc-visual-console/blob/main/docs/vanilla-viewer-resources.md). `action:"viewer-retry"` retries only presentation on the existing body after repair, keeping actions and game login intact. SDK hosts use `runtime.viewerResources("status"|"retry")`; the owner console also offers a retry button. These diagnostics exclude account challenges and credentials.

The rc.87 candidate adds exact Java 1.21.5 visual resources built from the official client. Missing optional icons/display fonts do not disable the world picture. An entirely missing version pack still needs matching original models/registry; never relabel another version's state IDs. The new shared preparation command accepts any release supported by its actual registry, validates official metadata/client hashes, stages the build and keeps replaced packs. Original audio remains separately prepared. See the bundled Minecraft skill's `references/viewer-resources.md` for Agent-operated repair through a DSH filesystem/terminal capability preset.

Player conversation is offered to host wake policies by default (`chat-other`); `wakeOn` can explicitly opt out. Plain chat and public @mentions remain public, and chosen private replies prefer vanilla `/tell`. Player messages retain external provenance; a wake is an opportunity to decide, not a rule to answer every line.

`prepareMinecraftViewerAssets` is exported from `agent-mc-world/client` and
`agent-mc-world/extension`. It prepares explicit package templates and official
content-addressed audio in a host-owned cache; it does not connect a game or model.

The optional `onBaseReady({directory, total})` callback runs once after the catalog
is validated and base templates are copied, before audio downloads. A full offline
bundle without a deferred catalog also receives the callback, with `total: 0`.
The host may adopt this directory and start its body while retaining the complete
preparation Promise. An asynchronous callback is awaited; its failure prevents
downloads and rejects preparation. Cancellation is checked before and after it.

Base readiness does **not** certify complete audio. Only the preparation Promise
resolving after a `ready` progress report confirms all catalog entries were
verified. HTTP failures, integrity failures and timeouts still reject the Promise.
Do not swallow them and label the resources complete. A retry uses the same cache
and verifies existing objects; neither a completion flag nor a prior attempt is
proof of a valid file. Audio hashes, size checks and official download URLs remain
enforced.

Hosts starting before completion must own this background work: handle rejection
immediately, expose pending/failed audio separately from connection readiness,
and offer an explicit retry without reissuing game actions. On stop or replacement,
abort the supplied signal and await preparation settling. Late progress or base
callbacks from a stopped instance must not configure a replacement instance.
If the base fails before the handoff, do not launch an engine with an unprepared
directory. The existing blocking behavior remains available by omitting the
callback and awaiting the whole Promise.

These are SDK/client resource helpers, not model-facing Minecraft actions. SDK,
MCP and host adapters share the same underlying package; no model endpoint,
personality, private assets or server-specific download policy is supplied here.
