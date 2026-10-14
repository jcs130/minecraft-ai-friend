# Real Java client body

The default independent body remains Mineflayer. Set `world.provider` to `java-client` to attach to an already connected real client with the separately built `agent-mc-java-bridge`. The SDK/MCP runtime does not launch a game, connect an external server, claim control or run a model implicitly.

```json
{
  "dataDir": "./stable-ledger",
  "world": {
    "provider": "java-client",
    "host": "your-server.example",
    "username": "AgentTest",
    "auth": "offline",
    "version": "1.20.6",
    "javaClient": {
      "expectedUuid": "12345678-1234-1234-1234-123456789abc",
      "expectedServer": "your-server.example:25565",
      "controllerId": "test-controller",
      "credentialsFile": "./game/agent-mc-bridge/connection.json",
      "ledgerDir": "./stable-ledger",
      "leaseMs": 15000
    }
  }
}
```

Paths in a loaded JSON file resolve relative to that file. `expectedUuid` is the actual server-assigned player UUID, not a guessed display name. `offlineUuid(name)` is useful only for servers using the standard offline UUID convention; verify the snapshot. Default port suffixes are normalized, aliases are not. Changed identity/address stops control. Microsoft profile renames may retain UUID; offline renames usually do not. Keep explicit ledger directories and handle migrations deliberately.

The credentials file contains a local secret and a new instance ID per launch. Only loopback HTTP is accepted, without redirects. For a remote core use a trusted local executor or separately secured tunnel; this adapter does not expose the game token over the LAN.

## Execution

1. Join the intended server normally and attach with SDK `connect()` or MCP `mc_connection`.
2. Read `mc_capabilities`, `mc_operations`, `mc_help`.
3. Host begins a real decision turn, then explicitly `mc_control {action:"claim"}`. Renew before the lease expires. Autonomy's controller does this while polling, including during slow model calls.
4. Submit `mc_do {action_id,operation,input}`. Use only discovered native operations; Mineflayer scripts are not advertised by this backend.
5. Consume `mc_result`, cancellable `mc_wait` and `minecraft.client.action` events. Accepted is not completed; an RPC return is not end-of-turn. Chat/use/menu input can be partial despite successful dispatch.
6. A cancelled wait only ends waiting. `mc_cancel` cancels one body action; `mc_stop` cancels this controller's queue. Disconnect releases this controller and keys. No automatic reconnect or late action replay.
7. Unknown dispatch/recovered actions require reconciliation under the **original ID**. An unknown result is nonterminal and blocks goal-success claims.

Both SDK and MCP retain `agent-mc/v1` task IDs, terminals, barriers, explicit turns, event cursors, facts/archive and cancellation. The additional body contract is `agent-mc-java/v1`, publicly exported through `agent-mc-world/client` and `agent-mc-world/contracts`. Its action result is evidence, not proof of host goal completion.

## Facts and visual capture

Current facts contain compact identity/vitals/inventory/menu/action readings replaced by key. Large books and complete component values are not repeated in each model request. `mc_bag` queries the original inventory/cursor/slots; `mc_visual` returns a real framebuffer and paired state. Task evidence and tool responses remain queryable through the standard archive. Photography can save the real capture and use explicitly configured enhancement providers; no image model is required for capture.

`mc_notices` queries the last 50 actual system/player messages, including server guides received before attachment. Historical messages are observations, not newly delivered requests. Live messages carry sender/kind metadata; buffer gaps are explicit events rather than silent claims of complete delivery. The native client's local Minecraft log remains the fallback for messages already outside that window.

The actual native game window provides the rendered view; the SDK operator console is status/control, not a claim that a second Mineflayer renderer is showing the native client. Optional modern web presentation should consume this same body's captures/readings. Do not launch another player merely to render it.

## Current support

The first native bridge targets Fabric 1.20.6 only. HMCL may manage an independently installed matching instance, but importing a NeoForge 1.21.1 pack does not make this mod compatible. Minescript/Baritone adapters, general autonomous navigation/combat and automatic password login remain explicit follow-up work. Existing Mineflayer skills/reflexes are not silently forwarded to native operations. The core exposes only capabilities actually installed and verified.
