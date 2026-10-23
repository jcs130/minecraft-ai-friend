# Earlier core release notes

Dated implementation notes; current setup is in [README](../README.md) and [MCP](mcp.md).

`0.5.7-rc.70` preserves an explicit `stow.count` or `organize.rules[].keep` when
a container fills after accepting part of a transfer. Confirmed inventory,
cursor and container changes account for that partial transfer before another
container is tried; unknown receipts and cancellation still stop the operation.

`0.5.7-rc.69` can read an explicitly named top-level password field from a private
JSON identity (`credentialFormat: "json"`, `credentialField: "gamePassword"`).
Credentials remain scoped to the configured server and account. Invalid fields
fail without using an API token or another field as a fallback. See the
[server authorization lifecycle](server-auth-lifecycle.md).

`0.5.7-rc.68` renews an explicitly configured login on the same connection after
trusted server authorization revocation. It makes one credential attempt per
revocation and still requires a fresh server confirmation before any game operation.
Repeated failures and immediate revoke/confirm loops do not resubmit credentials;
registration and password changes are never automatic. See
[server authorization lifecycle](server-auth-lifecycle.md).

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

`0.5.7-rc.54` adds optional [Harness² practice](harness2.md): host-injected models,
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
builds continue to include audio and need no download. See [viewer setup](viewer-setup.md).

`0.5.7-rc.46` exposes `EventCursorError` through the shared SDK. Event reads
with a missing/wrong run or a cursor ahead of the journal remain rejected;
MCP returns the error code, current run/cursor metadata and an explicit bounded
`mc_events` recovery read. Consumers choose whether to take that read. The core
never silently rebinds an old cursor, creates game events or replays an action.

`0.5.7-rc.44` adds [inventory organization](inventory-organization.md)
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

`0.5.7-rc.42` completes the core [authored-action lifecycle](method-learning.md):
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

Opt-in [continuous gameplay evidence](gameplay-learning.md) follows an
existing Agent's operation journal and local viewer without controlling its
body or calling a language model. Typed MCAP/FlatBuffers records retain progress, risk,
failure, method and memory attribution across movement, crafting, gathering,
combat and other operations. Review candidates remain separate from approved
training examples; missing controls or independent server truth stay unknown.

The [embodied learning plan](embodied-learning.md) compares Minecraft and
robot-learning projects and provides episode-stable policy rollout, honest
rule/learned attribution statistics and opt-in local motor shadow inference.
Shadow recommendations never count as adopted actions or task successes.

Opt-in [local motor training](motor-training.md) provides voxel/state inputs,
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
memory and decisions. See [component boundaries](component-boundaries.md)
and the [information capability map](information-capabilities.md) for current
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
waits and execution checks remain authoritative. See [task admission](task-admission.md).

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
