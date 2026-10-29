# Native world identity and spatial memory

Java 1.21.1 sends a level key in `login.worldState.name` and `respawn.worldState.name`.
The adjacent `dimension` value selects a dimension **type** from the registry. Two
different levels can both use the overworld type. Older payloads can supply
`worldName` instead. The core reads these fields by capability, without requiring
a server extension or changing Mineflayer's `bot.game.dimension` physics/codec value.

`WorldRequestFacts.world`, `WorldSnapshot.world`, the identity fact and the place
readout expose `agent-mc-world-identity/v1`. Its `key` is the exact received level
key; `dimensionType` remains separate. `observedAt` is the identity-packet time,
not an ever-changing polling timestamp. The connection-local `revision` is stable
on a same-world respawn. `uuid` and `instanceId` remain null: vanilla packets do not
prove Bukkit UUIDs or dungeon run identity. A server recreating a world under the
same key requires additional authoritative instance evidence; key equality does
not prove continuity through that recreation.

The public `agent-mc-world/observations` entry exports `readWorldIdentity`.
Extensions can use `installWorldIdentity` and `worldScopedRealm` from
`agent-mc-world/extension`. Importing these entries does not create a connection,
send a command, subscribe another game client, or call a model.

Spatial realm namespaces combine the existing server identity with the native
world key. Missing native identity is explicitly unknown and uses a connection-local
namespace; the dimension type is never substituted as a persistent world key.
Existing per-realm goals, notes, exploration and blueprint state consequently
stay with their original world. Host conversation, personality and personal memory
are outside this mechanism. The portable method library retains its established
server/account/agent namespace, so reusable methods survive world switches and
restarts. Existing unknown/legacy records are retained, without
being silently rebound to the first world observed after upgrading. Offline
notebook calls without an observed native identity retain their legacy server
scope; they do not assert a current world or automatically search new world scopes.

Container records additionally carry their realm. A `ChestBook.forRealm` view is
frozen for each operation, so a late old-world window result cannot overwrite the
new world's container at identical coordinates. Reads, material totals, source
lists, furnace notices and clearing operate only on that view. Unscoped legacy
entries remain available through the unscoped historical book. The reader does
not rewrite files. Encoded scoped keys survive older consumers that preserve map
keys while omitting new record fields.

A native world switch invalidates spatial facts, nearby-player observations,
pending server queries and the old snapshot baseline. The existing executor
world/dimension-change path records cancellation of old coordinate work. Explicit
native transit and dispatched server-travel verification retain their existing
lifecycle; no unknown inventory operation is automatically replayed. Same-world
respawn keeps its established movement/death handling. Old combat targets are
released without claiming a kill; survival reflexes restart against the new scene.

For the optional Qiandengji pack, the server contract is documented in
`paper/integrations/essentials-chat/WORLD_IDENTITY.md` in the main repository.
The candidate RPG reply `location.world` supplies Bukkit name/key/UUID, and party
members in different worlds omit distance with `different_world`. Those server
fields do not imply that the vanilla core observed a UUID, nor do decorated chat
labels establish identity or visibility. The documented raw-packet experiment was
on an isolated Paper server, not a production reconnect of the live characters.

Source tests and packed SDK/MCP consumers must pass before release. Building this
candidate does not update running agents, publish npm, or authorize another reload.
