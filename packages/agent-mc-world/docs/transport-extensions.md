# Explicit connection transports

`Bridge` exposes protected `createBot(options: mineflayer.BotOptions): mineflayer.Bot`.
The default forwards the exact options to Mineflayer. A local server extension may
override it to negotiate a mod loader and install that connection's native
registries **before** Mineflayer injects its internal plugins.

Return one fresh bot synchronously. Do not start another controller, connection,
reconnect timer or action queue. The core still owns the original lifecycle,
ownership checks, cancellation, task identities and reconnect generation. Keep
the supplied authentication, host, version and shutdown semantics; reject a
transport/version mismatch explicitly. Readiness that requires an extra native
handshake must fence the extension's spawn callback until that handshake succeeds.

This hook does not infer Forge support, convert mod content, grant permissions,
choose a model or start a game. The SAO integration is a separately selected
1.20.1 acceptance consumer; the default maintenance target remains Java 1.21.1.
