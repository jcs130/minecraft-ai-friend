# Information capabilities and their owners

The normal shared entry points are `MinecraftAgentClient` (`agent-mc-world/client`),
`MinecraftClientWorld` (`agent-mc-world/extension`), `JavaClientWorld`
(`agent-mc-world/client`) and `createMinecraftMcpServer` (`agent-mc-world/mcp`).
An adapter must consume a tested package version and expose the returned tools,
facts, artifacts and events. Merely updating another host does not update its pin.

## Capability map

| Information | Shared implementation / entry | Evidence boundary |
| --- | --- | --- |
| Current position, dimension, health, food, inventory, equipment and queue | `core/world.ts` request facts; `mc_script` → `mc.state()`; native `mc_state` | Preserve sampling time and connection identity. Disconnected observations are not current. |
| Local voxels, collision rays, standability and path previews | `mc_scout` / `core/terrain.ts`, `core/cell-facts.ts` and observation skills | Loaded local evidence only. Failed search does not establish absence or global inaccessibility. |
| Visible people, entities, distance and line of sight | `mc_attention`, `mc_risk`; shared perception and player observations | Online is not nearby; identity, relation and occluded facts remain unknown unless observed. |
| Heard sounds | `mc_hear` / `core/perception-hearing.ts` | Actual sound packets with age and coarse direction, not invented entities or exact coordinates. |
| Oxygen, breathing, received damage and recovery | `mc_script` → `bot.read("breathing")`; `core/breathing.ts` | Mineflayer primitive; capability-check other backends. Unknown air/age stays null. |
| Item components, current containers and GUI inventory | `mc_bag`; native `mc_state`, `mc_evidence` | Cached chest notes are historical. Recheck an actual window before acting. |
| Tools and exact parameter contracts | `mc_tool_help` / `src/client/tool-help.ts` | Generated from effective definitions. JSON-pointer expansion or explicit `full:true`; never executes the inspected tool. |
| Action and JavaScript manuals | `mc_help`, `mc_script {api:...}` | Discover the actual backend subset with capabilities; do not guess unsupported methods. |
| Vanilla foods, recipes, blocks and mining references | `mc_knowledge` / `core/knowledge.ts` | Versioned references, not proof of current stock or server-modified rules. |
| Received chat, private messages and server notices | `mc_messages` / `src/client/message-inbox.ts` | Historical, bounded and scoped; retains sender/source/time. The preview includes different speakers and mentions of the configured recipient. `review` only marks consideration. |
| Native pre-attachment message buffer | `mc_notices` / `src/client/java-client.ts` | Read-only buffer with sequence coverage; old requests are not replayed as new commands. |
| Images, structured visual fallback, maps and photography | `mc_visual`, `mc_view_map`, `mc_photo` | Images require host image capability. Structured fallback is not image understanding; authored enhancement is not game evidence. |
| Execution admission, completion, failure and original receipts | `agent-mc/v1`, `mc_queue`, `mc_blocked`, SDK `task`, MCP `mc_protocol` | Admission, method completion and host-goal success are different. Preserve IDs and unknown effects. |
| Events, full original artifacts and archives | SDK journal/events/current facts; MCP `mc_events`, `mc_artifact`, `mc_protocol` | Cursor and artifact availability do not establish provider delivery or image comprehension. |
| Game-only memory and external memory services | `mc_memory`, `GameMemoryService`, scoped local/remote providers | Configuration, authenticated retrieval, Agent adoption and demonstrated benefit need separate evidence. |
| Method library and operation-learning evidence | `mc_script {library:...}`, `mc_memory {action:"experience",...}` | Source versions, decisions, actual execution and negative evidence stay linked. Saving a method is not learned improvement. |
| Battlefield, action ownership and fast-decision candidates | `agent-mc-world/tactics`, `agent-mc-world/decisions` | Shared state/candidate contracts; the host supplies its decision service. Unknown mana/allies/cooldowns stay unknown. |
| Blueprint checks, resources, temporary supports and measured effects | `mc_blueprint`, `mc_check`, `mc_script` building/state guides | Dry-run and an already satisfied condition do not prove new construction or an aesthetic judgment. |

## What remains outside the generic core

- `agent-mc-qiandengji` is the optional, host-neutral server package. It owns
  `/mycli` protocols, server skill catalogs, mana/cooldown payload decoding,
  protection protocols, guild/trial ledgers and the server's manuals. Any host can
  explicitly select that package; ordinary Minecraft must not silently gain its rules.
- Host history selection, personal memory, persona, LLM credentials and model
  scheduling remain host responsibilities. TTS/music/streaming performance belong
  to the independent VTuber integration. They are not Minecraft observation ports.
- Shared renderer code/assets remain in `mc-visual-console`; private character
  models and deployment references are not public core defaults.
- `MinecraftWorldProxy` is a lower-level engine IPC primitive. Compose it with
  `MinecraftClientWorld` or explicitly use the exported `MessageInbox` helpers
  when building a custom facade. The normal SDK/MCP already does this composition.

## Shared message index

`mc_messages` supports `list`, `search`, `read` and explicit `review`, channel and
text filters, pagination, original IDs and scoped readback revisions. It keeps at
most 256 observations with bounded originals and a two-entry request index.
Overlay HUD and self echoes are excluded. Search/read never re-queues a message,
calls a model, controls the body or marks a goal complete. Corrupt or unwritable
storage is reported while original event delivery continues.

Native channel metadata takes precedence over quoted text. A player's sentence
starting with `[MC 系统]` remains player speech. Pre-attachment native messages stay
available through `mc_notices`; attaching the index does not replay that buffer.

Custom adapters may configure presentation/storage names with `MessageInboxOptions`
and rebuild schema discovery after namespacing via `withToolHelp(tools, name)`.
This preserves old files without copying the implementation. A facade that
already owns a shared native inbox can pass `JavaClientServices.messageInbox:false`
to avoid writing a second book.
