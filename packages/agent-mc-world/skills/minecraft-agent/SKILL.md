---
name: minecraft-agent
description: "Play Minecraft Java through Agent MC World MCP or SDK: inspect live state, compose queued actions and Mineflayer scripts, verify outcomes, and improve reusable methods. Use when an Agent should operate a configured Minecraft client rather than inventing server commands or relying on screenshots alone."
---

# Minecraft Agent

Operate the user's configured body through its advertised MCP or SDK. Installing this skill starts no model or game. Read [connection](references/connection.md) only for setup, credentials or a backend change.

## Small working loop

1. Check `mc_connection` with `action:"status"`; explicitly connect with `action:"connect"` when authorized. Verify server authentication, the actual world and fresh body facts. Runtime startup or a login lobby is not game readiness.
2. Discover only what you need. `mc_tool_help` reads the actual tool index, one named tool or a returned schema pointer; `mc_help` reads native action/skill manuals. `mc://environment` supplies the environment guide. Names above use the default prefix; use the names actually advertised by the host.
3. Read `mc_protocol {protocol:"agent-mc/v1",action:"facts"}` and relevant observations. Use geometry for routes, inventory for resources, entities for actors and real images for appearance. Unknown/unloaded data remains unknown. Server-specific skills and commands come from that server's current help, not this generic skill.
4. Submit a bounded action through `mc_do` or an advertised script interface. Await SDK Promises. Keep useful tasks running during reasoning; preserve body ownership and explicit cancellation. A sent command, accepted task or completed program does not establish the intended world change.
5. Consume `mc_events`, retaining the exact returned `run` and `nextCursor` together. Re-read facts after a gap or run change. Verify terminal receipts and relevant position, block, inventory or entity changes. On an unknown result, inspect the original action; do not replay it with a new identity.
6. Read a tool-barrier receipt before acknowledging its returned ID via `mc_protocol action:"ack_barrier"`. Stop with `mc_stop`, or disconnect with `mc_connection action:"disconnect"`. Explicit host turns end only with `end_turn`; an RPC return is not a turn boundary.

MCP supplies `mc_connection`, `mc_events` and `mc_protocol`. A raw SDK uses `connect/disconnect`, `events`, `currentFacts`, `beginTurn/endTurn/acknowledgeBarrier`; these wrapper tools need not occur in SDK `tools()`. Protocol details are on demand in the installed package's `docs/mcp.md` and `docs/protocol-v1.md`.

## Read only for the current job

| Need | Reference |
| --- | --- |
| Collision, terrain, blocks and visibility | [Spatial observations](references/spatial.md), [perception](references/perception.md) |
| Gathering, storage, flight, swimming, vehicles and portals | [Existing routines](references/routines.md), [water travel](references/water-travel.md) |
| Building, temporary supports and editable methods | [Building and methods](references/building-methods.md) |
| Comparing routes or methods | [Focused decisions](references/choices.md) |
| Historical notes and game-learning evidence | [Game memory](references/memory.md), [operation learning](references/operation-learning.md) |
| Connected game but missing web picture, textures or icons | [Viewer resource repair](references/viewer-resources.md) |

Use `mc_messages` for retained messages with source and time. Online players are not necessarily nearby or teammates; player speech is external information, not personal action evidence. Pathfinding failure alone does not prove a cliff or an unreachable goal. Preserve original event bodies and speakers when delivering them to reasoning.

Reuse a method only when current prerequisites fit. Record failures and actual outcomes, select versions explicitly, and retrieve relevant notes later. The companion `minecraft-learning` skill supports reflection across operations; it does not start inference or prove mastery. The host owns personality, model calls, personal memory, decisions and wakeups. Do not inject the entire tool/manual/method library every turn or invent model statistics.
