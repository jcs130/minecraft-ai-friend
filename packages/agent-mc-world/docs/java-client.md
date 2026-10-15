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
    "version": "1.21.1",
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
4. Submit `mc_do {action_id,operation,input}`, or use the shared JavaScript method interface described below. Use only capabilities advertised by the actual bridge.
5. Consume `mc_result`, cancellable `mc_wait` and `minecraft.client.action` events. Accepted is not completed; an RPC return is not end-of-turn. Chat/use/menu input can be partial despite successful dispatch.
6. A cancelled wait only ends waiting. `mc_cancel` cancels one body action; `mc_stop` cancels this controller's queue. Disconnect releases this controller and keys. No automatic reconnect or late action replay.
7. Unknown dispatch/recovered actions require reconciliation under the **original ID**. An unknown result is nonterminal and blocks goal-success claims.

Both SDK and MCP retain `agent-mc/v1` task IDs, terminals, barriers, explicit turns, event cursors, facts/archive and cancellation. The additional body contract is `agent-mc-java/v1`, publicly exported through `agent-mc-world/client` and `agent-mc-world/contracts`. Its action result is evidence, not proof of host goal completion.

## Facts and visual capture

Current facts contain compact identity/vitals/inventory/menu/action readings replaced by key. Large books and complete component values are not repeated in each model request. `mc_bag` queries the original inventory/cursor/slots; `mc_visual` returns a real framebuffer and paired state. Task evidence and tool responses remain queryable through the standard archive. Photography can save the real capture and use explicitly configured enhancement providers; no image model is required for capture.

`mc_notices` queries the last 50 actual system/player messages, including server guides received before attachment. Historical messages are observations, not newly delivered requests. Live messages carry sender/kind metadata; buffer gaps are explicit events rather than silent claims of complete delivery. The native client's local Minecraft log remains the fallback for messages already outside that window.

`mc_help {skill}` retains the compatible legacy chat/control/look/equip/eat/use step shape used by `mc_do {steps:[...]}`. For example, legacy control takes keys/durationMs and translates to native move/ticks under the same action ID. `mc_operations` exposes the lower-level native names; unsupported legacy skills remain explicit failures. Known Python signature/member errors retain their original terminal and add the pinned API reference without rewriting or redispatching a program.

Close a client GUI using `mc_do {operation:"close_screen",input:{screenToken},action_id}` with the token from a fresh `mc_state`. Server chat commands and a generic Escape/key operation do not close native menus through this API. On a `Stale screenToken` rejection, the adapter performs one read-only state query and returns the current screen/title/token/revision/cursor, or explicitly marks that observation unavailable. It never retries the click/close, replaces its token automatically, or reports the rejected attempt as a completed task. An empty screen means no GUI is currently open; the closing actor remains unknown. Read fresh slots/buttons before deciding another click. A previous uncertain action with the same ID still requires its original result, even when the newest submission was rejected.

The actual native game window provides the rendered view; the SDK operator console is status/control, not a claim that a second Mineflayer renderer is showing the native client. Optional modern web presentation should consume this same body's captures/readings. Do not launch another player merely to render it.

## Shared Agent JavaScript methods

The native bridge advertises `methodAdapter: "agent-mc-method/v1"` and its exact `methodCalls` list. With a matching bridge, `mc_script` reuses the **same** SES worker, `mc`/`bot`/`Vec3` interface, validation, bounded trace and immutable method library as the Mineflayer provider. It does not rewrite JavaScript to Python or create a second game connection.

```js
// mc_script {language:"javascript",name:"inspect-and-step",code:...}
const before = await bot.read('entity');
const floor = await bot.blockAt(before.position.offset(0, -1, 0));
await bot.setControlState('forward', true);
await bot.waitForTicks(4);
await bot.clearControlStates();
const after = await bot.read('entity');
return { before: before.position, after: after.position,
  floor: floor?.name, properties: floor?.getProperties() };
```

The first body call reserves the existing native queue until program completion/cancellation. Movement keys and held use survive awaited calls, and waits count actual client ticks. View angles use Mineflayer radians; inventory snapshots map the native hotbar to slots 36–44, armor to 5–8 and offhand to 45. A body method renews only the already explicitly claimed controller lease while active. `mc.do` after a body reservation is rejected to avoid waiting on its own queue. Other tool body submissions are rejected while a method or its cleanup owns execution. Cancellation addresses only that program's original action IDs; uncertain cleanup prevents another program until reconciliation.

Both providers also accept bounded nested reads: `entity.position` / `entity.velocity` and their `.x/.y/.z`, `entity.id/yaw/pitch/onGround`, `game.dimension`, and `heldItem.name/displayName/type/count/slot/instanceHash`. These project one freshly read public snapshot, count as one SDK call, and keep Vec3 behavior. Missing projected values are null; no private fields or arbitrary live-object traversal is exposed. Root-object reads remain compatible with earlier bridges.

`{name,code}` selects JavaScript for existing Agent scripts. Explicit `language:"python"` preserves trusted Minescript. Legacy unnamed code still selects Python, so an old program cannot silently change languages. For JS guides select `{language:"javascript",api:"index"}` / `api:"compatibility"`; Python guides retain their separate API. JavaScript syntax validation does not require a running game or Minescript. The native bridge version is checked before execution; a bridge without the v1 baseline fails without dispatch. Optional additions are checked against its actual `methodCalls` before a native call, so earlier v1 bridges can still run their existing methods.

`validate`, `runId`, `call`, `library:{op:"list"|"read"|"save"}` and `procedure` reuse the original version format and source hashes. Native library storage is under the private ledger, scoped by server, actual UUID and controller. Existing versions are portable, but moving a library between identities/backends is explicit: do not merge another character's methods or claim that saved code has been validated in the new world.

| Area | Current native support / boundary |
| --- | --- |
| Observations | `read`, `blockAt`, `findBlock(s)`, `canSeeBlock`, `inventory.items`, `getControlState`. Real client registry IDs; block identity/state/position/properties only. Unloaded/occluded is null. Native outline ray visibility can be more conservative than Mineflayer. Other block fields remain unavailable. |
| Movement | `look`, `lookAt`, held `setControlState`, `clearControlStates`, actual `waitForTicks`. No pathfinding or teleport alias. Native view assignment does not reproduce Mineflayer's smoothing curve. |
| Interaction | `activateBlock` validates current block/reach/line of sight/hand and lets the new look pass through a game tick before vanilla dispatch. `activateItem(false)` and `deactivateItem` preserve held use. Receipts confirm dispatch, not a crop growing or a server transaction. |
| Equipment | `equip(item,"hand")` selects a fresh hotbar stack. Bridges advertising `inventoryPick: agent-mc-inventory-pick/v1` also take storage slots9–35 through vanilla server pick, retaining the displaced stack. It waits for matching source/hotbar/selection responses; the client does not predict the swap. `setQuickBarSlot(0..8)` selects a hotbar index without moving items. Items carry component/count identity hashes (full components via `mc_bag`), but are not complete prismarine-item instances. |
| SDK groups | `mc.state` returns known readings and null for unavailable systems. `mc.do` currently supports one existing legacy-compatible step; unsupported groups fail before execution and partial native dispatch remains `done:false`. |
| Still unavailable | Digging/placing, `unequip`, armor/offhand equipment, flight plans, broad skill groups, arbitrary Mineflayer plugins/events and pathfinder. Missing APIs never become successful no-ops. |

`findBlocks({point?,matching,maxDistance?,count?,useExtraInfo?})` returns observed positions nearest first; `findBlock(options)` returns the nearest observed Block or null. Both backends take actual numeric block registry IDs (or an array of 1–64 IDs), not function predicates across the worker JSON boundary. Read a registry entry first and filter returned properties in the program. Native searches use radius 1–16 (default 16), count 1–64 (default 1); Mineflayer permits radius 32. The entire native search sphere must be within 32 blocks of the eyes. Only loaded, ray-visible blocks qualify. Unloaded/hidden blocks are unknown; an empty result does not prove absence in unexplored or occluded space.

To bound game-thread work, a native search permits at most 256 matching visibility checks. Exceeding that limit fails explicitly, rather than returning an incomplete empty result; narrow the radius or matching IDs. `useExtraInfo` accepts a boolean but does not add unavailable native block fields or NBT. These are read-only calls and do not reserve the body. `setQuickBarSlot`, `findBlock` and `findBlocks` require their individual advertised capability, while old v1 bridge methods remain usable.

```js
// This source runs on both matching backends; native limits are used here.
const crop = await bot.read('registry.blocksByName.carrots');
const positions = await bot.findBlocks({matching:crop.id,maxDistance:4,count:8});
const observed = [];
for (const position of positions) {
  const block = await bot.blockAt(position);
  if (block) observed.push({position:block.position,properties:block.getProperties()});
}
return observed; // observation, not proof of harvesting or planting
```

Read `runId/call` for expanded SDK receipts and compare actual before/after blocks or inventory. A program named “planted”, a custom `{ok:true}` or a completed worker is not evidence of planting. Native programs have the same bounded source, calls, time and version limits as Mineflayer methods; the native body adds a maximum reservation duration and cleanup on GUI takeover, death, disconnect, dimension/player change or a large position discontinuity.

## Current support

Both `bot.equip(freshItem,"hand")` and `mc_do {steps:[{skill:"equip",item:"wheat_seeds",hand:"main"}],action_id}` use the same native equipment implementation. The named step requires one unique current stack; the JavaScript form can identify a particular stack by its fresh slot/hash. A queued named step rechecks that hash at dispatch. No item is automatically used or planted. GUI/cursor ownership, held use, inventory identity and the single body queue remain enforced.

For storage equip the native client calls vanilla [pickFromInventory](https://maven.fabricmc.net/docs/yarn-1.21.1%2Bbuild.3/net/minecraft/client/network/ClientPlayerInteractionManager.html#pickFromInventory(int)). The bridge observes actual applied inventory/selection packets, including the displaced stack and count/component hashes. There is no forged revision, local inventory edit, synthetic click chain or inferred slot selection. `inventoryTransfer` retains the original action/call ID. Five seconds without confirmation becomes **unknown**, blocks new body work and permits observation/reconciliation. Late packets can resolve that original action; cancellation cannot unsend the request. A changed connection retires the observation scope without replaying an old request. This source capability needs a matching bridge loaded; older bridges stay hotbar-only.

The shared SES worker permits32 SDK calls per run, including reads, with default60s/max120s. `Date.now` and global timers are not available. Use bounded iterations and `await bot.waitForTicks`, then continue from a fresh observation in a subsequent run. A budget failure does not establish an impassable route.

Separate native bridge builds target Fabric 1.20.6 and 1.21.1 with Java 21; install the build matching the actual game. HMCL may manage the instance; a NeoForge pack does not make a Fabric mod compatible. Optional trusted Python requires explicitly installed/enabled Minescript 4.0. General autonomous native navigation/combat and Baritone remain follow-up work. Existing Mineflayer skills/reflexes and arbitrary plugins are not silently forwarded to native operations. Compilation/protocol fixtures are separate from acceptance in an actual connected game.
