# Observed command routing

`ObservedCommandCatalog` is exported from `agent-mc-world/extension` for optional server adapters. It holds bounded, expiring command usage observed during the current connection. Adapters parse their own protocol; the core does not know a particular server's command roots or game rules.

Use `MinecraftWorld.extensionServerFeedback(text)` to receive system-position messages after player/private-chat attribution has settled. Do not populate capability evidence from the early `extensionMessage` hook, ordinary player chat, role-play statements or a model's proposed commands. Clear the catalog on a new connection.

`misplacedPrefix(command, toolPrefix)` detects a narrowly defined routing mistake: a tool inserts a command prefix although a current server usage specifies a different route for those literal command words. It returns the observed usage, ID, time and a suggested command preserving caller arguments. It does not execute, rewrite arguments, infer success or confirm permission. A matching observed original route wins; unknown, expired and cleared evidence returns `null`. A server adapter should also retain explicitly known genuine abilities when names collide.

The optional server integration can use this result to fail **before sending** and return the exact observed usage plus a normal chat-tool example. The agent remains responsible for prerequisites and the resulting game action. Do not turn a command suggestion into a fabricated completion receipt.
