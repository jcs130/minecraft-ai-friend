# Agent MC World

Development candidate rc.113 adds [logical chat transport receipts](docs/chat-delivery.md)
so SDK/MCP and host consumers can distinguish admitted chat from actual client
dispatch and correlate queued messages to their task step. Sending does not imply
recipient acknowledgment or completion of an action described in the message.

Published package: **0.5.7-rc.89** on npm's **next** tag and [GitHub Release](https://github.com/jcs130/minecraft-ai-friend/releases/tag/agent-mc-world-v0.5.7-rc.89). Install this preview with `npm install agent-mc-world@0.5.7-rc.89`. Java **1.21.1** remains the primary target; supported protocols remain selectable and the host owns its model, personality, decisions and personal memory.

Development candidate **0.5.7-rc.99** includes independent, explicitly declared
[read-only server queries](docs/server-query-lifecycle.md) that do not wait behind
navigation. Queued command reply tracking begins at the actual transport call,
not task admission. It also includes self-contained task progress,
explicit unknowns when world snapshots are unavailable, validated batch message
reads, verified opening-spell candidates, script-worker versus body-lease checks,
and idempotent attributed-note retries. It retains the rc.90 composter fix, whose
receipts distinguish compost level, item consumption and actual bone-meal gain.
This candidate is not an npm release; the published preview remains rc.89.

[Journey decisions](docs/journey-decisions.md) retain current route observations
and configurable movement tolerance while the host considers a short visit.
Safe checkpoint insertion preserves the original task; no hidden model loop or
automatic detour is introduced.

When exact prebuilt vanilla materials are absent, the web viewer automatically selects compatible materials while preserving the actual connection's block IDs in the browser and mesher. Unknown materials use local placeholders; optional icons, fonts, paintings or audio do not block terrain. An incomplete old cache can fall back to bundled resources. Refreshing the viewer keeps the body and session. Users can connect without building resources; exact materials remain an optional enhancement. See [viewer resources](docs/viewer-resources.md).

Optional MineDojo historical indexes use `mc_knowledge`: explicit local preparation, source/coverage manifests, bounded reads, BM25 + CPU token vectors and optional matching embeddings. See [preparation and queries](docs/minedojo-knowledge.md). CPU token vectors are lexical. No corpus, SQLite database or automatic model/game startup is bundled. Vanilla player skins, public-chat defaults, configurable effects and the [server notebook](docs/agent-notebook-settings.md) remain available; mineral queries are off by default.

Anonymous npm downloads match the original reviewed GitHub archives byte for byte. Unmodified official DSH 0.2.1-rc.2 / rc.3 passed default pnpm registry installation, main/Worker loading and real local knowledge queries; see [npm verification](docs/npm-release-rc89.json). The 22-page retrieval smoke retains four coverage gaps and is not a full-Wiki or gameplay benchmark. Source, publication and live deployment are recorded separately. Published archives and earlier evidence are preserved.

The rc.85 candidate exposes a [base-viewer readiness handoff](docs/viewer-resources.md)
so audio preparation need not hold the game connection. Reviewed World storage
migration uses bounded parallel I/O with the same conflict, source-change and
completion verification. Neither change starts a game or model implicitly.

The rc.84 candidate adds [isolated World mounts](docs/world-mounts.md), reviewed
copy-only legacy migration, envelope namespace mapping and an explicitly configured
host-side decision transport. These helpers start no game or model by import.

It also includes the upstream AuthMe login-receipt compatibility and distinct
missing-prompt, credential-read and confirmation timeout diagnostics.

The rc.73 candidate adds opt-in [per-skill generation contracts](docs/skill-generation-contracts.md). Compatible harnesses can constrain required coordinates and mutually exclusive input forms before generation; the native parser, queue and permissions remain authoritative.

The rc.77 candidate adds [bounded observations and trustworthy tool receipts](docs/bounded-tool-results.md): immediate `mc_observe`, fixed absolute cursors, explicit unknowns, structured diagnostics and original-request reconciliation.

## Start small

- [MCP setup and minimal calls](docs/mcp.md): configure one body, discover tools, connect explicitly and verify actual readiness.
- [SDK and client](docs/minecraft-client.md); [login lifecycle](docs/server-auth-lifecycle.md).
- [Progressive context reading](docs/context-reading.md): engine-free source previews and current-fact formatting through `agent-mc-world/context` (rc.72+), preserving source identities and uncertainty. This does not add MCP tools or start a connection.
- [Minecraft skill](skills/minecraft-agent/SKILL.md): a short entry, with detailed references only when needed.
- `mc_connection` checks the body connection; `mc_protocol action:facts` reads body facts. Server gameplay commands are separate and discovered in that server's help.
- `mc_tool_help` reads tool parameters; `mc_help` reads native action/skill manuals. Do not preload all tool schemas or manuals into each decision.

The rc.71 fix lets pure method syntax validation finish after a failed game connection; actual execution still cancels on disconnect and explicit stop still cancels validation. See [the fix](docs/OFFLINE_VALIDATION_DISCONNECT.md). Earlier version notes are in [release history](docs/RELEASE_NOTES.md).

Reusable Agent Skills: [minecraft-agent](skills/minecraft-agent/SKILL.md) operates the client;
[minecraft-learning](skills/minecraft-learning/SKILL.md) reviews and improves all operations,
including flight, blink, spells, gathering and combat. Shared SDK/MCP operation evidence and
local lesson recall live in this core, with host-owned decisions and personal memory.
Use `mc_memory {action:"experience",operation:"help"}`. No additional inference is started.
`node scripts/package-skills.mjs <output-directory>` creates an allowlisted, checksummed
portable skill bundle without runtime state, credentials or game assets. It does not publish
to a marketplace or install/connect the runtime. See [the learning contract](docs/operation-learning.md).

Primary optimization and acceptance target: **Minecraft Java 1.21.1**. Other
versions remain selectable; the public SDK keeps explicit/automatic negotiation.
See the [information capability map](docs/information-capabilities.md) for SDK/MCP
observation, original evidence, memory and optional server-pack boundaries.
`mc_messages` now shares retained message search/review across normal client entry
points. `mc_tool_help` reads actual tool schemas progressively, including MCP
transport tools at the MCP boundary. Neither invokes a model or replays actions.

The core supplies [versioned vanilla knowledge](docs/vanilla-knowledge.md) through
`mc_knowledge`: search summaries, then read needed food/cooking/health, item,
mining or crafting references locally without loading a manual into every turn.

## Responsibilities

This package owns the Mineflayer connection, inventory synchronization, navigation,
validated actions, executable methods, evidence receipts, current facts/archive,
deduplication, goal revisions, cancellation, SDK/MCP and the viewer integration.
The host owns personality, goals, planning model calls, decisions and personal long-term memory.

The core's five-slot goal projection can survive a reload through the configured
`dataDir`, scoped to world/account/Agent. It restores intentions and historical
judgments, rechecks mechanical conditions, and never replays actions. See
[goal recovery and combat equipment](docs/goal-recovery.md).
The core also offers [game memory](docs/game-memory.md): scoped historical notes with local keywords, optional embeddings or external memory services. It never turns recalled notes into current world facts.

The SDK/MCP native backend uses that same notebook. A host mounting the body
directly supplies storage with `new JavaClientWorld(cfg, fetch, { dataDir,
agentName, accountName })`; native storage is bound to the explicitly configured
server and player UUID plus agent identity. `accountName` is only a display alias.
Historical reads and attributed notes work while
disconnected, without client RPC or a control lease. `capture` alone requires a
fresh identity-checked body reading; offline dimension stays unknown. Existing
`dataDir/minecraft-memory` notes retain their server/account/agent scope. Older
alias-scoped notes are never implicitly imported into a UUID scope. A deployment
upgrade must explicitly verify the same account and preserve IDs, all revisions,
authors and sources when migrating a notebook; keep the original backup.

Native player chat uses the shared `minecraft.chat` event with `senderKey`,
`meta.uname` and `socialScope: minecraft-server`, derived from the bridge's player
channel, while preserving original text, timestamp and sequence. System/HUD
notices remain `minecraft.client.message`; text alone never establishes a player
identity. Own echoes do not wake the Agent as incoming players. When storage is
configured, bounded local relationship recall precedes incoming chat using the
same notebook. This performs no model/cloud request and makes no nearby/teammate
claim. Optional server packs may normalize their documented arrival notices.
The core starts no model loop. Connecting to a game server is explicit.

Version 0.5.6 includes strict blueprint operation admission, explicit crafting
count units and a loopback human account console bound to its executor. It keeps
Mineflayer death recovery: `deathRespawnDelayMs` defaults to
4000 and accepts 0–15000 milliseconds. It disables implicit native auto-respawn
and dispatches at most once per actual death. Stop, disconnect, connection
replacement and an early server respawn cancel the pending dispatch. Death still
cancels the original native tasks and leases; none of that work is replayed.
`bot.deathLifecycle` and death event metadata expose the episode ID, observed
time, phase and pending deadline. Fresh facts include the actual account/realm
identity and lifecycle. Service-side immediate respawn can shorten the display.
The host may retain structured `meta.death` with the actual journal event
run/cursor/time; missing official cause remains unknown. Built-in guides are
optional knowledge, never a required activity sequence.

Native collision shapes, sight, body clearance and hazards are separate contracts.
See the [Java 1.21.1 state audit](docs/native-collision.md) for exact empty/partial
shape handling, door/gate/trapdoor behavior, test coverage and remaining limits.

Consumers depend on the package, never on another host's checkout:

- `cortico-world-qiandengji`: Cortico API 6 adapter, public name 联机版我的世界; older private hosts use a separately validated compatibility package.
- `agent-mc-qiandengji`: explicitly selected server protocols and reference guides.
- `dsh-minecraft-agent`: native DeepSeek Harness adapter.
- Other hosts: use `agent-mc-world`, `/client`, `/contracts` or `/mcp`.

The modern visualization remains maintained in `jcs130/mc-visual-console`.
Server packs and performance services require explicit configuration.

Generic battlefield sampling, authored tactics, combat receipts and ability state
are provided by `agent-mc-world/tactics`; optional host selector helpers are in
`agent-mc-world/decisions`. The default SDK/MCP client exposes `mc_combat_tactic`
without a server pack. See [component boundaries](docs/component-boundaries.md).

Hosts that need combat decisions during a slow planning generation can connect
`HostCombatDriver` to `client.hostTactics(args, { signal, requestId })`.
This narrow port accepts only `{ battlefield: true }` or an exact `{ choice }`.
It does not acquire the planner's turn; samples do not flood the tool journal.
Choices remain idempotent and are rejected while a planner tool owns admission.
Drain/cancel the driver around real tool operations, not around model inference.
Connection, target, tactic revision and executable conditions are rechecked.

With explicit `combatOptions.allowMovement` / `allowEngage` authorization, the
candidate set includes proactive withdrawal and a nonattacking `track` controller
as well as engagement. Tracking maintains a 5–8 block band on physics ticks under
a short renewable lease; it stops on lost identity/sight or expiry and checks
loaded safe ground before moving. Set `maxCandidates` to at least 3 to expose the
different tactics. No host selector or inference starts by importing the package.

With `allowEngage:true`, authored spell rules with an `intent` may be offered
before the native melee controller starts, including when there is no sword or
usable bow. Ability availability, mana/cost/cooldown, visible hostiles in the
configured engagement scope, rule predicates, health and body admission must
all pass again at dispatch. Sampling never casts a spell. `fight:off`, emergency
ownership and a noninterruptible body task still prevent an opening. This does
not grant spell range, aim, server success or melee capability.
An active read-only/computational script is not a body lease and does not hide
fast combat choices. A native script holding control, or a script awaiting its
executor task, still owns the body. A second authored method cannot start while
the first worker remains active.

Server messages using the chat transport carry `meta.channel:"system"` when
there is no named player source. Player speech and outgoing private echoes keep
their original provenance, so host reply/speech lanes can distinguish telemetry
from a new conversation without parsing server-specific text.

## Spatial observations

The same SDK/MCP action interface offers compact site diagnostics, local 3D voxels,
collision rays, terrain slices and actual viewer captures. `mc_scout` with
`{"steps":[{"skill":"observe","mode":"sites","sites":[[103,64,-31]]}]}`
reads target occupancy, support height, adjacent collision faces and standing
clearance without moving or building. Results retain unknowns and sampling time;
geometry is not proof of reachability or server placement permission.
See the [on-demand spatial guide](skills/minecraft-agent/references/spatial.md).

Construction also reports bounded blueprint proportions, exposed materials and known
headroom problems. Temporary supports have provenance-based cleanup, fresh retained
obligations and an explicit `cleanup` action. Agent-authored supports may use
`build temporary:true`. The final ground waypoints are checked for unplanned rises
outside the ordinary jump envelope before movement; this is not a complete route proof.
Dry damaging drops are also rejected. A short prediction using the body's installed
physics engine checks live pathfinder control against received collision shapes and
brakes before a predicted cliff fall. Lower destination coordinates never exempt an
observed deep fall. See [navigation safety and its limits](docs/navigation-fall-safety.md).

`mc_script` includes a host-independent method library with scoped, immutable source
versions, syntax-validation requirements, parent conflict checks and explicit execution
or rollback. Saved source is not evaluated gameplay evidence. See
[building and editable methods](skills/minecraft-agent/references/building-methods.md).

Reviewed [Mineflayer work routines](docs/work-routines.md) are discoverable through
`mc_script {"routine":{"op":"list"}}`: harvest/replant, exact-cell logging,
surplus storage and restocking reuse the existing body queue and return verified
block/quantity evidence, partial results and remaining work. No extra model loop
or server NPC mod is required. Reviewed [movement routines](docs/movement-routines.md)
also cover verified waypoints, bounded swimming and permission-aware segmented
flight, with actual positions, unknown-safe oxygen and remaining legs.
The [advanced mobility guide](docs/advanced-mobility.md) covers oxygen-aware
underwater detours, exact vehicle identity, portal itineraries and native elytra
controls. Existing physics and body ownership remain in place.

## Build and verification

Run commands in this package directory. Node >=22 is required.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build:engine
pnpm typecheck
pnpm test
pnpm pack
```

The engine-only build works without a viewer archive and labels that omission in `dist/build.json`. It does not provide screenshots. For a viewer release, explicitly prepare the exact archive named by `release-sources.json` (currently Java 1.21.1) with `node scripts/prepare-viewer.mjs /absolute/path/to/the-locked-archive.tgz`, then run `pnpm build:release`. The shared visual project supplies that input; hashes and matching assets are verified. Source checkout, packaged runtime and actual rendered gameplay are separate evidence.

See [client setup](docs/minecraft-client.md), [accounts](docs/online-accounts.md),
[protocol](docs/protocol-v1.md) and [host integration](docs/harness.md).
For confirmed inventory operations and recovery after a timeout, see
[inventory synchronization](docs/inventory-synchronization.md).
Historical import licenses and hashes remain in `provenance/` and
`vendor/native-types/`. The repository move is recorded separately; no identities,
goals, memories, credentials or game ledgers are moved by installing this package.

The build version and exact dependencies are recorded in `package.json` and
`release-sources.json`. Source synchronization does not establish publication or
deployment. Java 1.21.1 is the primary viewer/build acceptance target; matching
1.20.6 resources remain an explicit compatibility input.

Installed runtime and engine children execute the compiled JavaScript directly on Node; they do not require a TypeScript loader or its native build scripts. Source checkouts retain `tsx` as a development dependency for source children and training tools. Both child-launch paths share the same implementation; launching a compiled package does not inherit the host's TypeScript loader flags.

## Photography and optional cloud artwork

The locked candidate bundles matching Java 1.21.1 viewer assets from the shared visual repository while retaining explicit 1.20.6 assets. Mineflayer item decoding, biome IDs and texture URLs use the action connection's version. It retains guarded ground navigation and limits unsticking to short crouched moves over loaded continuous dry support; cancellation releases held keys. These checks do not certify every fall scenario. Package versions and source hashes are recorded in the manifests rather than inferred from a locally running wrapper.

Proxy reconfiguration expires unanswered one-shot known-packs replies, suspends physics and blocks old-world movement packets until a fresh PLAY position arrives. The caller's previous physics setting is restored, including an explicitly disabled setting. Protocol startup alone does not open gameplay readiness. The guard is scoped to the owned connection and does not edit dependency files or server configuration.

The public SDK exposes optional metadata-only `status().connection` (`ready`, `phase`) separately from runtime startup. Engine proxy samples expire after five seconds; composed server packs retain this facet through `console()`. Missing or stale samples stay `null`. No authentication RPC or secret enters this facet. Source, packed-package verification and live scene evidence remain separate; this candidate is not published.

`mc_photo` saves web screenshots with paired game readings without an image model. Image, video and music generation belongs to the independent cortico-world-aigc extension. This core captures screenshots/voxel evidence and retains legacy archives without model adapters or hidden inference; the host selects references and creative intent. [Configuration, lifecycle and fallback guide](docs/PHOTOGRAPHY.md).


### Contact and server feedback facts

`standingOn` identifies a collision face touching the player's footprint, including block edges and fractional-height blocks. The feet's center cell can be air while an adjacent block supports the body. Unloaded or unresolved support remains unknown; it is never narrated as air. Airborne motion does not claim a block below as current support. The viewer surface readout uses the same calculation.

`serverFeedback` retains up to three recent server rejection/error observations for ten minutes, including system messages and raw action-bar packets. It is historical server text with channel, receipt time and task identity, not a permission grant or proof of an action's effect. Matching blocked/partial task receipts also preserve text received during that task, without claiming causation. Full messages remain in the event archive. Repeated HUD values, player chat and duplicate raw/high-level packets do not create new error observations. Server-specific decoding and protection policy belong to optional extensions.

`mc_messages read` accepts one `id` or an explicit `ids` batch of 1–16 retained message IDs, preserving each source and reception time. Missing/malformed selectors return `messages.selector` with a correction; only valid but absent IDs return `messages.retained-id`. Reading never marks messages reviewed. Successful `list`, `search` and `read` receipts expose `meta.readback` (`agent-mc-readback/v1`) with a realm/account-scoped resource and content revision. Equivalent keyword/query filters share a resource; changed observations, pagination and review state remain distinguishable. Consumers may use this to recognize repeated results; an unchanged history query proves neither current world state nor goal progress. The inbox does not cache away calls, trigger model work or choose an action.

### Current combat capabilities and movement

Tactical request facts expose a bounded `combatCapabilities` index of observed abilities and the current authored configuration. Fast decision frames likewise include observed, unconfigured skills with `configured: false`; this does not authorize a cast. Costs and cooldowns remain `null` until observed, and excess skills are counted explicitly. Hosts can read the existing tactic and skill-source contracts before proposing a revision; the core neither invents abilities nor silently adds rules.

Known inedible items are rejected before an action batch replaces or extends the body queue. The diagnostic lists confirmed edible inventory instead of similarly named ingredients. Unresolved custom items retain their existing behavior. Vertical swim waypoints preserve heading inside the horizontal movement deadband; support, oxygen checks and cancellation ownership remain unchanged.

### Remember retries

Identical normalized `mc_memory remember` notes in the same realm/account/agent scope reuse the latest unarchived entry ID and revision. The receipt adds `deduplicated: true, written: false`; `saved: true` still means local persistence, not successful remote indexing. Source, speaker, observed time, content, dimension, tag set and expiry must all match. Recorded time and expiry are never refreshed. Explicit revisions/captures and changed evidence remain separate; existing duplicates are not deleted.
