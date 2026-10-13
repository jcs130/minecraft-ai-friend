---
name: minecraft-agent
description: "Play Minecraft Java through Agent MC World MCP or SDK: inspect live state, compose queued actions and Mineflayer scripts, verify outcomes, and improve reusable methods. Use when an Agent should operate a configured Minecraft client rather than inventing server commands or relying on screenshots alone."
---

# Minecraft Agent

Read [connection](references/connection.md) for installation, private configuration and supported authentication. Installing this skill does not start a model or connect the game.

1. Discover the actual `mc_*` tool schemas and read `mc://environment`. Explicitly connect with `mc_connection`, then verify login, world identity and current facts. Use your own account, directory and ports.
2. Choose an observation for the question: blocks/collision for geometry, inventory for resources, entities for nearby actors, real images for appearance. Preserve sampling time and source. Unknown or unloaded facts stay unknown.
3. Read `mc_help` for action contracts, or `mc_script {"api":"index"}` for native Mineflayer interfaces. Fetch only the needed topic. Learn server-specific skills from that server's help and actual receipts; no RPG command, account prefix, teammate relationship or permission is assumed.
4. Submit ordered actions through `mc_do` or scripts. Every SDK call returns a Promise: await it before reading results. Useful running tasks continue during reasoning. Respect body ownership and explicit cancellation; do not replace them just to stay busy.
5. Acceptance is not completion. Consume `mc_events`, preserving `run` and `nextCursor`; detect run changes or gaps and re-read facts. Deliver actual event bodies, speakers and times to your reasoning context. Verify terminal results plus the relevant position, block, inventory or entity change.
6. Improve methods when evidence warrants it: record author, hypothesis, source/hash, parent version, applicable conditions, validation, expanded receipts and world change. Keep counterexamples, adopt/revert explicitly, and retrieve the method in the next applicable scene. Source existence or one random win is not learning.

`mc_artifact` stores selected UTF-8 execution artifacts. Versioned `agent-mc.procedure/v1` artifacts (legacy `cortico.procedure/v1` remains readable) can compose existing game methods; the format does not require the Cortico framework. Your host owns memory, retrieval, evaluation and event wakeups. Do not inject the whole method library every turn.

Read actual tool availability before using quick tactics. The generic client currently exposes native control and ordinary reflexes; the legacy RPG tactic/spell adapter is not a default capability. Do not claim a tool or server skill exists because an old server guide mentioned it.

Report actual progress and limits. Pathfinding failure alone does not prove a cliff or an unreachable destination. Online players are not necessarily nearby or teammates. Preserve chat provenance; unverified speech is not personal success. Model latency/token/cache statistics must come from host instrumentation, not guesses.

Use `mc_protocol` with protocol `agent-mc/v1` to begin/end actual host decision turns and acknowledge tool barriers. RPC completion never ends a turn. Preserve execution IDs, terminal state, triggers and original evidence. Cancel waits explicitly; an already accepted task must be stopped through its task or script controls. Keep environment prefix bytes stable, replace current facts by key at the request tail, and budget tool descriptions plus reserved output. Use archive queries and artifact handles to retrieve originals omitted from a bounded prompt.
