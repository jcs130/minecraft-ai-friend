# FAWE on the Youer hybrid server

`HybridItemPatch` fixes the pinned FAWE 2.16.1 item's ordinal lookup for real
non-Minecraft `Material` values injected by Youer. The original vanilla lookup
is retained. Custom names resolve through WorldEdit's item registry, allocating
a unique internal ID once under the registry lock. Invalid/non-item values are
not silently mapped to AIR, and WorldGuard listeners are not bypassed.

Build with Java 21 using `build-item-adapter.py --help`. The builder checks the
original JAR hash and emits a deterministic patched JAR plus its manifest.
This is distinct from the older BrushListener-only compatibility plugin.

`tests/SoulSpellFixture.java` and `tests/soul-spell-stage.mjs` require a disposable
loopback server and marker; they are never installed in production. Main/offhand
native block-use packets verify one owned maid per soul spell and the returned
empty spell. Vanilla item mapping and WorldGuard block protection are also
checked. See `../../docs/PLAYER_NAVIGATION_20261114.md` for acceptance boundaries.
