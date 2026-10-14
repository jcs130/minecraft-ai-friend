# Minecraft component boundaries

`agent-mc-world` is the reusable game runtime. A host is the application running
an Agent: for example Cortico or DSH. Hosts supply personality, long-term memory,
goals, model connections and decisions. A host adapter translates their tool,
event and lifecycle interfaces; it must not maintain another game implementation.

| Component | Owns |
| --- | --- |
| `agent-mc-world` | Connections, inventory synchronization, navigation, water/flight controls, following, combat execution, perception, scripts, body leases, cancellation, task terminals and evidence receipts |
| `agent-mc-world/tactics` | Native battlefield observations, bounded candidate generation, authored tactic workers, ability state, rules, versioned tactic storage and encounter receipts |
| `agent-mc-world/decisions` | Optional host-side selector helpers, explicitly constructed and started by a host; the game process never starts them |
| Host adapter | Tool/event names, host model connection selection, lifecycle forwarding and configuration UI |
| Optional server pack | Server command syntax, authenticated custom protocols, ability catalogues and game-specific rules/guides |
| `mc-visual-console` | Shared renderer source and visual assets; the core consumes a versioned build |

## Generic tactics are available without a server pack

The default SDK/MCP client exposes `mc_combat_tactic`, and its default child
factory constructs `TacticalMinecraftWorld`. Installing Qiandengji is unnecessary
for battlefield sampling, authored programs, validated engagement/steps or combat
receipts. No vanilla spell is invented: default ability catalogues are empty,
mana remains unknown, and the base execution hook sends no spell command.

`CombatAbilities` stores observed ability state and evaluates rules. A server
pack may subclass it to decode its own messages and provide explicit fallback
defaults. `TacticalMinecraftWorld` rechecks body ownership, current revision,
connection generation, targets and collisions before executing a submitted choice.
Party telemetry is listened to only when an extension supplies a channel.

Hosts can construct `HostCombatDriver` from `/decisions` and supply their saved
decision connection through its `decisions.request` port. The separate optional
host service also retains the explicitly configured endpoint compatibility path.
Importing it starts no requests; shutdown cancels pending choices. None of its
endpoint or credential configuration is passed into the game process.

## Extension compatibility

Server extensions use public exports, never `node_modules/.../core` paths or a
neighbouring source checkout. The low-level `MinecraftWorld` extension base remains
available; extensions requiring tactical execution derive from the public
`TacticalMinecraftWorld` and call inherited lifecycle hooks.

The 2026-10-14 extraction retains the existing `minecraft-combat-tactics.json`
version 1 format and realm keys, program source/hash, tactic revisions and last
five combat receipts. Former Qiandengji module paths re-export the core during
migration. They contain no second implementation or worker.

## Verification gates

- Full core tests, declarations, build hashes and isolated package installation.
- Generic SDK tool discovery and a real IPC child can install/read/restore a
  tactic with the server connection disabled and no server pack installed.
- Server and host packages resolve the same installed core; legacy exports have
  the same class/function identities as public core exports.
- Installing a package does not establish live gameplay improvement. Deployment,
  state preservation and actual inventory/game results are recorded separately.

This extraction is maintenance work, not an Agent-authored learning result.
