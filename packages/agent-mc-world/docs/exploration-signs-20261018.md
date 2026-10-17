# Signs, partial observations and compressed stair routes

Observed on Cormy's Mineflayer connection in 千灯纪, 2026-10-18 (client 1.21.1): a 3249-cell query saw 332 cells and left 2917 unknown. The host model called the crypt a confirmed empty dead end. A server rejection concerned breaking protected entrance blocks and explicitly directed players to use the stairs. Neither receipt established that the whole route was closed or empty.

## Core fixes

- `look` at an observed sign and `observe sites` now return received front/back text without opening an editor. Script `blockAt`/`findBlock` snapshots preserve `.sign`; the shared worker restores synchronous `getSignText()`. The independent extension exports the same reader.
- The pinned prismarine-block getter returns empty strings even with no block entity. Check received side payloads before interpreting blank text. Unknown or malformed sides stay null. Text is bounded and quoted as world data, not promoted to instructions. Occluded or unloaded signs remain unobserved.
- An empty-hand `use` receipt now says that opening an editor does not establish a blank sign and points to the read-only path.
- A short compressed path edge can span several real half-stairs. Before rejecting a large upward node delta, the core may certify a no-jump walk using the installed collision physics. No state or control is applied. A wall or unknown collision still fails; dry-drop protection remains intact.

## Evidence limits

Tests use the pinned 1.21.1 and explicit 1.20.6 sign codec, the real script worker, current visibility gate and real 1.21.1 physics. They verify original text, missing-versus-blank data, no edit packet, occlusion, stair passage, wall/unknown rejection and no live body mutation. They do not establish a successful production crypt exploration. The current host model's correction after a signed maintenance reminder is assisted correction, not autonomous learning or RSI.

The on-demand perception guide preserves observed/unknown coverage and distinguishes a rejected block action from a closed route. Core code does not invent a destination, force a dungeon script, replay an abandoned body task or claim that the model will follow a guide it has not actually read.
