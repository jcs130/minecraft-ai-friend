# Protection reply world identity

Protection queries, cached action denials and navigation predicates use the
native login/respawn level key. `bot.game.dimension` describes physics and
cannot identify distinct server maps using the same dimension type.

The existing `ProtectReply.dimension` field keeps its wire/API name. Its
value is the server level name when native identity is available. The
`minecraft:` prefix is normalized consistently with existing replies; other
namespaces remain distinct. Older connections without a native level name
retain their previous dimension-key behavior. Physics and registry lookup
are unchanged.

A denial remains limited to the action, world and cell supplied by the
server. It is not generalized into a whole-building or dungeon restriction.
Ordinary actions still do not require a permission query by default.
Permission checks after an unconfirmed action use the same world identity
as the reply cache. Foreign-world replies cannot reset the current route.
Original server text remains available to the host.

The regression uses a 1.21.1 native level with `overworld` physics, an exact
cell denial, and a transfer to a second level at identical coordinates.
Actual placement-wrapper tests verify that a denial arriving after the
second send prevents the third attempt in direct and pathfinder placement.
This proves identity and retry handling, not that an alternative route
exists or that a live dungeon has been completed.

Primary-source reference: [Mineflayer game plugin](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugins/game.js)
keeps dimension-type lookup separate from protocol level names. Validation
uses the package's pinned Mineflayer and Minecraft 1.21.1 data.
