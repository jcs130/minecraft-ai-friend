# Agent MC World

Independent Minecraft execution core, maintained in `jcs130/minecraft-ai-friend`.
Package name: `agent-mc-world`. Protocol: `agent-mc/v1`.

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
The core supplies [versioned vanilla knowledge](docs/vanilla-knowledge.md) through
`mc_knowledge`: search summaries, then read needed food/cooking/health, item,
mining or crafting references locally without loading a manual into every turn.

## Responsibilities

This package owns the Mineflayer connection, inventory synchronization, navigation,
validated actions, executable methods, evidence receipts, current facts/archive,
deduplication, goal revisions, cancellation, SDK/MCP and the viewer integration.
The host owns personality, goals, planning model calls, decisions and personal long-term memory.
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

- `cortico-world-qiandengji`: Cortico API 5 adapter, public name 联机版我的世界.
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

## Build and verification

Run commands in this package directory. Node >=22 is required.

```sh
pnpm install --frozen-lockfile
node scripts/prepare-viewer.mjs /path/to/mc-visual-console-java-1.20.6.tgz
pnpm build
pnpm typecheck
pnpm test
pnpm pack
```

The viewer archive is a release input from the shared visual project, locked by
`release-sources.json`. It is intentionally excluded from this repository's Git
source. The prepare command checks its exact SHA256 before copying it; it never
downloads or scans for a service. With dependencies and this archive prepared,
build/test work offline, without Cortico, DSH, a server checkout or live services.
Missing inputs fail explicitly. The built npm package includes the viewer and
does not need either source repository at runtime.

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

## Photography and optional cloud artwork

The locked candidate bundles matching Java 1.21.1 viewer assets from the shared visual repository while retaining explicit 1.20.6 assets. Mineflayer item decoding, biome IDs and texture URLs use the action connection's version. It retains guarded ground navigation and limits unsticking to short crouched moves over loaded continuous dry support; cancellation releases held keys. These checks do not certify every fall scenario. Package versions and source hashes are recorded in the manifests rather than inferred from a locally running wrapper.

Proxy reconfiguration expires unanswered one-shot known-packs replies, suspends physics and blocks old-world movement packets until a fresh PLAY position arrives. The caller's previous physics setting is restored, including an explicitly disabled setting. Protocol startup alone does not open gameplay readiness. The guard is scoped to the owned connection and does not edit dependency files or server configuration.

The public SDK exposes optional metadata-only `status().connection` (`ready`, `phase`) separately from runtime startup. Engine proxy samples expire after five seconds; composed server packs retain this facet through `console()`. Missing or stale samples stay `null`. No authentication RPC or secret enters this facet. Source, packed-package verification and live scene evidence remain separate; this candidate is not published.

`mc_photo` saves web screenshots with paired game readings without an image model. Optional native Alibaba Bailian and ByteDance Volcengine Ark adapters add photo enhancement and original artwork; the host Agent owns interpretation, prompts and creative decisions. Providers default to disabled. [Configuration, lifecycle and fallback guide](docs/PHOTOGRAPHY.md).
