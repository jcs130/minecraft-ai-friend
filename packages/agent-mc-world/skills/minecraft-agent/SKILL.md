---
name: minecraft-agent
description: "Play Minecraft Java through Agent MC World MCP or SDK: inspect live state, compose queued actions and Mineflayer scripts, verify outcomes, and improve reusable methods. Use when an Agent should operate a configured Minecraft client rather than inventing server commands or relying on screenshots alone."
---

# Minecraft Agent

Read [connection](references/connection.md) for installation, private configuration and supported authentication. Installing this skill does not start a model or connect the game.

1. Discover the actual `mc_*` tool schemas and read `mc://environment`. Explicitly connect with `mc_connection`, then verify login, world identity and current facts. Use your own account, directory and ports.
2. Choose an observation for the question: blocks/collision for geometry, inventory for resources, entities for nearby actors, real images for appearance. For build/route questions, see [spatial tools](references/spatial.md): compact site diagnostics, voxels, collision rays and terrain slices. Preserve sampling time and source. Unknown or unloaded facts stay unknown.
3. Use `mc_tool_help` for the actual tool index and JSON-pointer schema subtrees; `mc_help` reads action contracts, and `mc_script {"api":"index"}` reads native Mineflayer interfaces. Fetch only the needed topic. `mc_messages` searches retained chat/notices with source/time; old messages are historical, not new requests or current state. Learn server-specific skills from that server's help and actual receipts; no RPG command, account prefix, teammate relationship or permission is assumed.
4. Submit ordered actions through `mc_do` or scripts. Every SDK call returns a Promise: await it before reading results. Useful running tasks continue during reasoning. Respect body ownership and explicit cancellation; do not replace them just to stay busy.
5. Acceptance is not completion. Consume `mc_events`, preserving `run` and `nextCursor`; detect run changes or gaps and re-read facts. Deliver actual event bodies, speakers and times to your reasoning context. Verify terminal results plus the relevant position, block, inventory or entity change.
6. Improve methods when evidence warrants it: record author, hypothesis, source/hash, parent version, applicable conditions, validation, expanded receipts and world change. Keep counterexamples, adopt/revert explicitly, and retrieve the method in the next applicable scene. Source existence or one random win is not learning.

For building, cleanup and editing your own methods, read [building and methods](references/building-methods.md), or request `mc_script {"api":"building"}` / `{"api":"methods"}`. Both guides are on demand; current cleanup obligations arrive separately as fresh facts.

For game lessons, attribution, failed-write recovery and optional service learning, read [game memory](references/memory.md). Local notes and editable methods work without a cloud service; verify save, later retrieval, adoption and actual outcome separately.

For improvement across **all** operations (flight, blink, spells, movement, gathering, crafting, interaction and combat), use the companion `minecraft-learning` skill and [operation learning](references/operation-learning.md). SDK/MCP calls retain scoped choice/action metadata, fresh numeric observations and execution receipts in the core. Query `mc_memory {action:"experience",operation:"help"}` before reflecting. Retrieved lessons are historical Agent interpretations. Apply only when current prerequisites match; preserve failures and old method versions. Installing either skill starts no inference or game connection.

`mc_artifact` stores selected UTF-8 execution artifacts. Versioned `agent-mc.procedure/v1` artifacts (legacy `cortico.procedure/v1` remains readable) can compose existing game methods; the format does not require the Cortico framework. Your host owns memory, retrieval, evaluation and event wakeups. Do not inject the whole method library every turn.

Read actual tool availability before using quick tactics. The generic client currently exposes native control and ordinary reflexes; the legacy RPG tactic/spell adapter is not a default capability. Do not claim a tool or server skill exists because an old server guide mentioned it.

For a real choice between routes, survival actions, skills, methods or a longer goal, read [focused decisions](references/choices.md). `mc_choose` uses an optional host-owned service only when called; `mc_life` offers progressively read, editable life goals. Neither changes the active task automatically.

For crossing a river or travelling over water, read [water travel](references/water-travel.md) on demand. Compare an existing boat, crafting one, a bridge, swimming and a land detour using current materials, water geometry and a usable exit; the guide does not choose or start a route.

Report actual progress and limits. Pathfinding failure alone does not prove a cliff or an unreachable destination. Online players are not necessarily nearby or teammates. Preserve chat provenance; unverified speech is not personal success. Model latency/token/cache statistics must come from host instrumentation, not guesses.

Use `mc_protocol` with protocol `agent-mc/v1` to begin/end actual host decision turns and acknowledge tool barriers. RPC completion never ends a turn. Preserve execution IDs, terminal state, triggers and original evidence. Cancel waits explicitly; an already accepted task must be stopped through its task or script controls. Keep environment prefix bytes stable, replace current facts by key at the request tail, and budget tool descriptions plus reserved output. Use archive queries and artifact handles to retrieve originals omitted from a bounded prompt.
