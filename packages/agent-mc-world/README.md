# Agent MC World

Independent Minecraft execution core, maintained in `jcs130/minecraft-ai-friend`.
Package name: `agent-mc-world`. Protocol: `agent-mc/v1`.

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
The core starts no model loop. Connecting to a game server is explicit.

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
