# My Agent World native-mod extension

This optional extension adds the `minecraft_mod` LLM tool to the existing Minecraft plugin. It uses the existing GameAgentClient socket and the same mc-agent-neko player's Mineflayer connection; no extra Minecraft connection or model is created.

Use `operation=list`, then `explain` with an operation `id`, then `call` with an `args` object. `status` reports identity and unresolved native writes; `result` reads a previous durable `callId` without executing it again. A write may supply its own unique `callId`; otherwise the client generates one and returns it. Preserve it after any timeout. Never retry unknown effects under a new ID.

`native_mod_result` is returned only to the requesting socket. Native state includes the player's UUID and full components/SNBT. Native receipts are not ordinary game-chat or inventory broadcasts. A successful transport or spell cast is not proof of the task's target effect.

Configure `[game_agent].ws_url` to the patched Neko's loopback socket. Neko's `MAW_NEKO_ADAPTER_FILE` and `MAW_NEKO_LEDGER_DIR` enable the native adapter before spawn. The server's Agent gateway is LAN port 28977, Minecraft version 1.21.1. Every framework instance needs its own account and ledger.

The body validates argument schemas and write/read classification from installed bindings. Native writes require idle body ownership, durable intent/result, complete-component CAS and normal server permissions. Unknown native writes remain blocked across reconnect; client transport uncertainty requires querying the original receipt. Client waiters are in-memory; the body ledger is durable and must be consulted after process restart. No automatic replay.

This extension does not enable the full dialogue platform, assign a model, change plugin autostart, render a new web view, or assert all installed mods are playable. See the owning server repository's `docs/MY-AGENT-WORLD-NEKO.md` for pinned installation, live evidence and maintenance.
