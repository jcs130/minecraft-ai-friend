# Spatial receipt world identity

`mc_observe` and the `observe` skill return the native `world` observation for
sites, rays and both voxel formats. `dimension` remains the Mineflayer physics
type for compatibility. It does not identify a map: two distinct maps may both
use `overworld` physics.

The compact `readout` prefix exposes `worldKey` and `dimensionType` before the
potentially long geometry. `worldKey` comes only from native login/respawn level
names. Missing or legacy identities remain null; neither a dimension type nor
coordinates are used to invent a name. The full receipt retains source and
observation time. Bukkit UUID and dungeon instance identity remain unknown.

Spatial selection/revision hashes distinguish different known maps at identical
coordinates. Repeated identity packet timestamps do not by themselves alter a
spatial revision. Old records are not relabelled or migrated. These identifiers
are read evidence, not proof of arrival, task completion or a map transfer.

The repair adds receipt metadata only: it does not move the player, choose an
activity, change visibility, issue commands or loosen world/cursor isolation.
