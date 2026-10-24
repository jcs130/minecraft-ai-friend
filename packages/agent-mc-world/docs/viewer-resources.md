# Viewer resources and game startup

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
