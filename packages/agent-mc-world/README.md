# Agent MC World

`0.5.7-rc.68` renews an explicitly configured login on the same connection after
trusted server authorization revocation. It makes one credential attempt per
revocation and still requires a fresh server confirmation before any game operation.
Repeated failures and immediate revoke/confirm loops do not resubmit credentials;
registration and password changes are never automatic. See
[server authorization lifecycle](docs/server-auth-lifecycle.md).

`0.5.7-rc.67` includes all vanilla shulker-box colours in container discovery
and historical container selection. Slot reads, transfers and material counts
use the existing container paths. Saved contents remain last observations,
not a claim that a portable box is still at its recorded coordinates.

`0.5.7-rc.66` distinguishes a satisfied travel destination from a dispatched
server command in the default schema, help and execution receipt. Already being
at a destination still avoids sending a duplicate command. Queries and activity
commands use `chat.text`; their original server replies establish acceptance.
Travel completion alone does not establish command execution or activity membership.

`0.5.7-rc.59` lets `mc_goal.revise.progress` explicitly correct a recorded
numeric report while preserving the goal identity and checking its revision.
Omitting the report keeps it, `null` clears it, and omitted total/unit fields
keep their previous values. Readouts label these numbers as recorded reports,
not live world observations. The revision receipt retains the original and
replacement counts; changing a number does not verify a milestone or close a
project. Blueprint goals keep their own single source of progress.

`0.5.7-rc.58` waits for a nonempty native terrain commit before admitting a
photograph. The early hands/entities-only frame is a loading counterexample,
not an image of an empty or safe world. Unsupported/empty scenes stay explicit.

`0.5.7-rc.56` captures the optional native renderer's real first/third/3dview
routes and committed scene without requiring legacy chunk-map globals. Native
coordinate-overview and custom FOV remain explicit unsupported requests;
existing legacy renderer behavior is preserved. Images do not establish full
scene parity or action success.

`0.5.7-rc.55` includes the current scoped goal ledger and its milestones in
`requestFacts().parts` as `goals`. SDK/MCP hosts no longer need an environment
prompt refresh to observe a newly registered or revised project. This reads the
existing table without a scan, model call, task dispatch or completion claim;
the table remains session-local and durable project notes belong in game memory.

`0.5.7-rc.54` adds optional [Harness² practice](docs/harness2.md): host-injected models,
isolated core method execution, an independent baseline/held-out gate and evidence-linked
game memory. The pinned Google algorithm is optional; imports start no model or game.
Practice results never automatically train weights, adopt a skill or take over a live body.

`0.5.7-rc.50` fixes the shared skill-field schema union: an enum from one
skill no longer restricts another skill's free-text field. In particular,
`organize.target=inventory/open` cannot reject `find.target=oak_log` or an
attack/entity target. The native per-skill parser still enforces each skill's
own enum, quantity and dependency rules before dispatch.

`0.5.7-rc.49` protects player/private chat, unknown chat, task and goal evidence
from the event condenser's built-in tutorial text filters. Full journals and
explicit caller rules are unchanged. These helpers remain opt-in. Movement
repetition diagnostics summarize supplied action targets and observations;
execution receipts and actual world changes must establish goal progress.

`0.5.7-rc.48` includes the shared model-context helpers added upstream:
optional schema collapse retains enum/array shapes, `compactFacts` projects
current facts without host-only revision metadata, `MovementProgress` can track
repeated observations, and `EventCondenser` offers explicit configurable event
windows. Event clocks use the local or configured time zone. These SDK helpers
do not install a model loop or silently filter a host's event/history stream;
callers opt in and retain original evidence. Existing native task and queue
semantics remain unchanged.

`0.5.7-rc.47` adds the shared `parseMinecraftServerAddress` and explicit
`prepareMinecraftViewerAssets` SDK/extension ports. `npm run build:release`
keeps viewer geometry, textures, original BGM and the complete versioned audio
catalog, then obtains original Minecraft audio from Mojang on first setup.
Preparation uses a deployment cache, verifies SHA-1/SHA-256 and size, shares
identical objects across versions and resumes after failure. It does not connect
to a game or model, and never writes into the installed package. Full private
builds continue to include audio and need no download. See [viewer setup](docs/viewer-setup.md).

`0.5.7-rc.46` exposes `EventCursorError` through the shared SDK. Event reads
with a missing/wrong run or a cursor ahead of the journal remain rejected;
MCP returns the error code, current run/cursor metadata and an explicit bounded
`mc_events` recovery read. Consumers choose whether to take that read. The core
never silently rebinds an old cursor, creates game events or replays an action.

`0.5.7-rc.44` adds [inventory organization](docs/inventory-organization.md)
through the shared `organize` action: merge and sort personal or open storage,
optionally stow/discard explicitly selected surplus while retaining caller-chosen
quantities. Mouse operations use confirmed server slots/cursor and exact modern
item components. Default organization preserves the quickbar and all items.
No timer, model call or implicit junk policy is installed.

`0.5.7-rc.43` adds the shared game/connection/model panel and an explicit
loopback host embedding policy. `serveClientConsole(..., undefined, undefined,
{ embedOrigins: ['http://127.0.0.1:17850'] })` permits that exact local host page
to embed the console; it does not authorize cross-origin API calls. Default
embedding remains disabled. Optional host metadata labels the configured model,
requested effort and operator pause without exposing prompts or credentials.

`0.5.7-rc.42` completes the core [authored-action lifecycle](docs/method-learning.md):
write new JavaScript actions, compose pinned child methods, retain original
execution receipts, review outcomes and select versions for later explicit reuse.
Current facts carry a small method index instead of whole sources. Stored code,
selected versions and verified gameplay improvement remain separate.

`0.5.7-rc.32` uses exact Java 1.21.1 ingredient tags for crafting and
preflight material checks, including mixed plank species in chests and beds.
The versioned reference is extracted from the hash-verified official client by
`scripts/extract-crafting-tags.py`; 1.20.6 keeps its own data and unsupported
versions keep the registry fallback. These are grid proposals, not permission
or a server-result claim: actual inventory gains still determine success.

`0.5.7-rc.31` uses the occupied feet cell consistently in task queues,
progress and world snapshots. Continuous positions are floored, including
negative coordinates; they are not rounded into a neighboring air cell.
`mc_check` keeps successful assertions with their named coordinates as well
as failures and unknowns, and labels the current feet cell when available.
Checking a front cell or an unobserved region does not establish that the
player's current support or the entire surrounding terrain is empty.

Opt-in [continuous gameplay evidence](docs/gameplay-learning.md) follows an
existing Agent's operation journal and local viewer without controlling its
body or calling a language model. Typed MCAP/FlatBuffers records retain progress, risk,
failure, method and memory attribution across movement, crafting, gathering,
combat and other operations. Review candidates remain separate from approved
training examples; missing controls or independent server truth stay unknown.

The [embodied learning plan](docs/embodied-learning.md) compares Minecraft and
robot-learning projects and provides episode-stable policy rollout, honest
rule/learned attribution statistics and opt-in local motor shadow inference.
Shadow recommendations never count as adopted actions or task successes.

Opt-in [local motor training](docs/motor-training.md) provides voxel/state inputs,
offline physics and an explicitly owned Minecraft 1.21.1 training server,
MCAP/FlatBuffers trajectories, behavioural cloning, dataset aggregation, Gymnasium/PPO
and portable policy inference through `agent-mc-world/motor`. Students receive final
targets without expert waypoints. Training never acquires production Agent control.

`0.5.7-rc.14` recognizes modern Java private chat after the actual registry
has resolved translation keys to format templates. The registered incoming
type supplies sender/content positions; public quotes remain public. Private
identity evidence also survives historical message indexing and viewer delivery.

`0.5.7-rc.13` reads standard incoming private messages from translation
arguments, preserving sender evidence across localized Java 1.21.1 chat and
system-chat transports. English plugin formats remain supported; public quotes
and mismatched packet identities cannot acquire verified private identity.

`0.5.7-rc.12` preserves decision attribution across the real engine-child IPC
boundary. Agent names and permissions stay unchanged; anonymous tool arguments
cannot claim provenance. The protocol regression covers MCP, SDK and the child
process together, including receipt replay, turn boundaries and cancellation.

`0.5.7-rc.11` carries explicit host-selected decision attribution through SDK
and MCP calls to viewer events. Controller identity stays separate from agent
names and roles. Anonymous calls remain unknown; tool arguments cannot claim
decision provenance. Existing named host-role attribution remains compatible.

`0.5.7-rc.10` preserves build approach failures: an unreachable placement reports
the navigation cause, measured foot cell and height difference, and says the
target placement was not sent. It does not turn an approach failure into a
server placement denial. Other reachable cells can still be placed, cancellation
still propagates, and no plan is rewritten or automatically retried.

Direct system/action-bar results that explicitly deny a block action with a
dimension and exact coordinates now update native admission memory. A matching
active dig ends with the complete server reason; later actions and pathfinding
skip that cell. A late denial does not abort unrelated work, and player quotes,
malformed results and other dimensions cannot create protection. Region rules,
custom channels and server guides remain optional server-pack responsibilities.

The primary product in `jcs130/minecraft-ai-friend`: a model-neutral, host-neutral
Minecraft execution and learning toolkit.
Package name: `agent-mc-world`. Protocol: `agent-mc/v1`.

General Minecraft capabilities belong in this package: observation and discovery,
actions/navigation, inventory/crafting, scripts and skill libraries, game memory,
learning/evaluation evidence, and fast-decision state/candidate contracts. Models
and hosts reuse the same implementation through SDK, MCP or public extension
ports. Host adapters map interfaces and lifecycle; server packs supply explicitly
selected protocols/rules. Hosts supply model connections, personality, personal
memory and decisions. See [component boundaries](docs/component-boundaries.md)
and the [information capability map](docs/information-capabilities.md) for current
entry points and backend/evidence limits.

`0.5.7-rc.8` distinguishes nearby navigation success from exact foot-cell arrival.
Spiral preview/execution share measured alignment feedback and the existing
`exact:true` contract. Batch previews do not treat approximate navigation or a
requested tunnel endpoint as a verified next starting cell. Rejected goal fields
return the supported names without accepting or mutating a goal. These changes
do not rewrite plans or add movement; live improvement requires deployment and
observed gameplay evidence.

`0.5.7-dev.20261017.3` aligns water-containing plant routing with the
installed collision physics and restores liquid waypoints from their original
A* cells instead of silently lowering them through kelp/seagrass. Route probes
and real navigation share the correction; no position/velocity or server
attribute is changed. Explicit native input still owns the entire program.
`bot.read("breathing")` adds timestamped oxygen/health observations and separate
damage/recovery counters for agent-authored diving budgets. See the focused
`api:"diving"` guide and `examples/adaptive-diving.mjs`: the latter only proposes
a decision from supplied observations/return costs, never performs a dive or
automatically promotes a learned skill. Simulation and contract tests do not
establish live route recovery or autonomous learning.

`protectionPreflight` defaults to false. With a server protection port, normal
digging, placing and path planning do not query permissions. An unconfirmed block
effect triggers a query for that target; explicit cached denials still apply.
Enable the setting for proactive per-block checks. The passive ACL remains a
source of known denials; missing coverage is unknown, not a denial.

`0.5.7-rc.4` prepares the complete shared Java 1.21.1 viewer with explicit
1.20.6 compatibility: version-matched original sounds, sound registry metadata,
and the eight-track shared original BGM library. The locked input records its
upstream commit and SHA-256. The npm package ships one compiled viewer tree;
the build archive and duplicate intermediate tree are not release payloads.
Run `npm run verify:release` in an installed package to verify shipped hashes,
public declarations and the neutral SDK entry. Private character assets,
deployment credentials and personal memory are not release inputs.
Includes the water input lease correction: an explicit key program retains
ownership until cleanup, so passive treading cannot overwrite its inputs.
These source and packaging checks do not establish live gameplay recovery.

The viewer keeps YSM/native body ownership consistent at final draw, shows
confirmed inventory operations, and labels brief closed-crafting snapshots.
Third-person and 2.5D observation omit the full-scene underwater tint;
actual water-medium observations and water meshes remain intact.
Confirmed window open/close events are collected immediately; slot packets
are coalesced before publication and detached on viewer teardown. Includes
the upstream bounded water-rescue progress correction from `bfa3882f`.
These are maintenance fixes, not evidence of autonomous learning.

0.5.7-dev.20261016.29 admits caller-selected discard batches and subsequent
pickups without requiring a container. Toss still checks observed space,
ambiguous custom items and settled inventory loss. Generic pickups exclude
recent identified discards, including explicitly aimed ones; named recipient
deliveries retain their separate receipt semantics.
Historical retries, storage oscillation, repeated peeks and successful-operation
counts now produce evidence notes instead of admission cooldowns. Server-reported
waits and execution checks remain authoritative. See [task admission](docs/task-admission.md).

0.5.7-dev.20261016.9 clarifies that admission-time crafting previews use current
confirmed stock without earlier unexecuted production or consumption. Tied
recipe examples are explicitly non-exhaustive; recipe selection and queue
execution still use actual inventory. Includes the respawn movement repair below.

0.5.7-dev.20261016.8 uses the first applied native spawn position as the spatial
baseline, including when health or inventory arrives first. Respawn displacement
is not reported as walking; the delayed landing notice preserves the measured
landing and subsequent walking. Inventory losses and body facts remain available.

0.5.7-dev.20261016.6 binds post-death inventory freshness to a full player
inventory packet after that episode's native respawn. Old cached inventory and
pre-respawn packets cannot authorize recovery; either inventory/spawn packet order
is supported without relaxing the existing inventory confirmation guard.

0.5.7-dev.20261016.5 fixes native nutrition arbitration: future, completed or
frozen meal proposals no longer suppress an available meal at a safe checkpoint.
Current consumption, inventory confirmation and native body ownership remain
authoritative. Post-death facts include the current measured position and inventory
for the host to reevaluate earlier objectives; no route is automatically replayed.

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

Installed runtime and engine children execute the compiled JavaScript directly on Node; they do not require a TypeScript loader or its native build scripts. Source checkouts retain `tsx` as a development dependency for source children and training tools. Both child-launch paths share the same implementation; launching a compiled package does not inherit the host's TypeScript loader flags.

## Photography and optional cloud artwork

The locked candidate bundles matching Java 1.21.1 viewer assets from the shared visual repository while retaining explicit 1.20.6 assets. Mineflayer item decoding, biome IDs and texture URLs use the action connection's version. It retains guarded ground navigation and limits unsticking to short crouched moves over loaded continuous dry support; cancellation releases held keys. These checks do not certify every fall scenario. Package versions and source hashes are recorded in the manifests rather than inferred from a locally running wrapper.

Proxy reconfiguration expires unanswered one-shot known-packs replies, suspends physics and blocks old-world movement packets until a fresh PLAY position arrives. The caller's previous physics setting is restored, including an explicitly disabled setting. Protocol startup alone does not open gameplay readiness. The guard is scoped to the owned connection and does not edit dependency files or server configuration.

The public SDK exposes optional metadata-only `status().connection` (`ready`, `phase`) separately from runtime startup. Engine proxy samples expire after five seconds; composed server packs retain this facet through `console()`. Missing or stale samples stay `null`. No authentication RPC or secret enters this facet. Source, packed-package verification and live scene evidence remain separate; this candidate is not published.

`mc_photo` saves web screenshots with paired game readings without an image model. Image, video and music generation belongs to the independent cortico-world-aigc extension. This core captures screenshots/voxel evidence and retains legacy archives without model adapters or hidden inference; the host selects references and creative intent. [Configuration, lifecycle and fallback guide](docs/PHOTOGRAPHY.md).


### Contact and server feedback facts

`standingOn` identifies a collision face touching the player's footprint, including block edges and fractional-height blocks. The feet's center cell can be air while an adjacent block supports the body. Unloaded or unresolved support remains unknown; it is never narrated as air. Airborne motion does not claim a block below as current support. The viewer surface readout uses the same calculation.

`serverFeedback` retains up to three recent server rejection/error observations for ten minutes, including system messages and raw action-bar packets. It is historical server text with channel, receipt time and task identity, not a permission grant or proof of an action's effect. Matching blocked/partial task receipts also preserve text received during that task, without claiming causation. Full messages remain in the event archive. Repeated HUD values, player chat and duplicate raw/high-level packets do not create new error observations. Server-specific decoding and protection policy belong to optional extensions.
