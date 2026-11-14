## 0.5.7-rc.160-preview.70

- Reconsider transport during measured surface-water journeys; retain destination and expose the complete boat_trip routine without forcing an action.
- Allow an owned meal checkpoint at a verified breathing surface, hold bounded buoyancy, and resume the original navigation after cleanup. Preserve underwater, combat, inventory and cancellation boundaries.

## 0.5.7-rc.160-preview.69

- Keep bounded last-seen hostile clues for 30 seconds across decision latency; retire confirmed deaths without treating entity removal as death or following hidden motion.
- Hand occluded combat contacts back as `lost-sight`, preserving low-health retreat and suspended-task recovery. Partial cover uses actual eye height and multiple body sight rays.
- Offer checked perpendicular search steps around cover, preferring observed contacts to ambient sounds. Native 1.21.1 ray/physics replay covers reacquisition without through-wall attacks.

## 0.5.7-rc.160-preview.68

- Retry undelivered combat attention on a fresh matching battlefield and suppress further shadow rankings only after the host acknowledges delivery.

## 0.5.7-rc.160-preview.67

- Allow opted-in autonomous idle strolling through the existing interruptible body lease. Balance movement against glance variants, vary local directions, bound consecutive strolls around an idle anchor, and suppress movement around hazards, hostiles and active body scripts.

## 0.5.7-rc.160-preview.66

- Expose observed offhand defense separately from backpack ownership; confirm and explain explicit shield replacement without forcing equipment choices.

## 0.5.7-rc.160-preview.65

- Separate physical fire contact from planner clearance. Validate explicit ranged spacing against the current local corridor; blocked retreat can still fire a verified shot. Clarify that a local combat clear does not complete a server room.

## 0.5.7-rc.160-preview.64

- Preserve combat ownership when fire has no executable escape; revalidate bounded search, unfinished-room intent and current armor/spare facts.

## 0.5.7-rc.160-preview.63

- Let explicit equipment transactions finish during low-health combat; retain native confirmation, cancellation and environmental rescue priority. Report authored candidate exclusions without adding or forcing attacks.

## 0.5.7-rc.160-preview.62

- Support bounded, read-only Numen battlefield snapshots and opt-in task-owner feedback for repeated ambiguous shadow rankings. Preserve native target references and the existing body controller.

## 0.5.7-rc.160-preview.61

- Bound accepted tactical event views for execution workers; retain source hashes and action/terminal distinction. Integrate native NeoForge login/appearance helpers and explicit per-account retryable service-unavailable disconnect markers.

## 0.5.7-rc.160-preview.60

- Clarify equipped engage versus observation-only track in fast combat requests. Preserve authored tactics but make live body ownership authoritative.
- Escalate a repeated idle ambiguous ranking once per unchanged encounter to the task owner with decision/scene/version evidence. Include actual non-execution in subsequent requests; retain selection thresholds and all action validation.
- Export typed host-decision feedback for ordinary World streams and active execution inboxes.

## 0.5.7-rc.160-preview.59

- Keep learning admission predicates in the parent tool table, alongside read-only predicates, instead of passing functions through the engine initialization IPC. Verify the actual combat tool and learning admission through a real SDK/MCP child lifecycle.

## 0.5.7-rc.160-preview.58

- Read current health, food, position and active work for Numen bodies that expose sampled facts. Keep the full inbox and native guide behind their existing explicit reads.

## 0.5.7-rc.160-preview.57

- Add collision-checked, costed fire crossings; release failed reflex ownership; expose bounded combat program probes/history and current identity observations.

## 0.5.7-rc.160-preview.56

- Prefer a received custom display name in visible entity observations while retaining the raw protocol type, UUID and executable target. No global mob rename, name-derived allegiance or hidden-name disclosure.
- Carry the same label through attention, proximity, SDK observations and the compact fast-decision request. A mod entity projected as a vanilla mob can be described by its actual received name without changing physics or targeting.
- Verify modern and legacy metadata, plain vanilla entities, arbitrary name tags, occlusion and server-attested companions. These checks do not attest an unprovided original mod type.

## 0.5.7-rc.160-preview.54

- Preserve a server-confirmed vehicle attachment when a later position or delayed respawn packet arrives; keep walking physics disabled while mounted. Treat passenger packets as full snapshots, including empty dismounts, without duplicate mount events.
- Include the current vehicle and bounded visible boats in travel facts, separately from carried boats and crafting supplies. Visible boats still require ownership and seat checks.
- Explain that replacing the pending queue leaves the active task running and identify the explicit immediate-preemption entry. Accept exact `minecraft:` food identifiers consistently in preflight and execution.
- Verify mounted physics in real deep water, both packet orders, modern and legacy passenger snapshots, actual food consumption, and queue preemption. These regressions do not certify a live completed boat journey.

## 0.5.7-rc.160-preview.52

- Include bounded, freshly synchronized boat material counts and carried workbenches in water-travel facts. Keep unknown stock distinct from absent stock and recipe readiness, and expose focused inventory/recipe/driving help without starting a body action.

## 0.5.7-rc.160-preview.51

- Report all independent entity/item goal-probe errors together; reject display names used as registry IDs. Preserve measured game voice duration failures and safe recovery without resending text or audio.

## 0.5.7-rc.160-preview.50

- Include a compact, current water-travel choice in the native body-owner facts during travel or water contact. Carry over the observed boat availability and point to recipe, placement, and driving help on demand.

## 0.5.7-rc.160-preview.45

- Report unchanged-scene placement retries suppressed by the local cache as `placement-retry-cached`, with no new packet sent and the original recovery conditions. Preserve cell iteration, cancellation, cache lifetime and actual placement behavior.
- Retain the current query-context and portal-entry fixes alongside the latest main-branch companion travel changes.

## 0.5.7-rc.160-preview.44

- Preserve block collision metadata in optimized path searches so explicitly selected Nether portals remain enterable. Task-scoped portal permission no longer mutates the shared search cache.
- Exercise portal entry, shallow water, raised sills, goal ownership, cancellation and measured dimension changes with the production pathfinder optimization enabled.

## 0.5.7-rc.160-preview.43

- Route into the selected Nether portal through actual collision and support checks, including raised sills; scope portal-entry permission to the owned route and restore it on cancellation or failure.
- Require measured dimension change for transit success and preserve that evidence when the old navigation is revoked by the transition. Explain the transit contract when an ordinary goto explicitly targets an observed portal block.

## 0.5.7-rc.160-preview.41

- Preserve complete configured routes after preferred walking preflight rejection, while retaining explicit walk-only and active no-dig leases.
- Report exact carried food IDs for recovery from localized selectors, and resolve registered vanilla resource IDs in gathering and block/entity matching.

## 0.5.7-rc.160-preview.40

- Add explicit precise ground polylines, segment posture, declared avoid cells/blocks, dynamic geometry checks and actual waypoint receipts through the shared action/script contract.
- Keep invisible, unloaded and omitted dense voxel counts distinct in current read feedback.

## 0.5.7-rc.160-preview.38

- Validate short grounded recovery and idle movement against the actual swept player volume and loaded collision shapes, instead of rejecting an entire cell beside a fence or open mechanism. Retain continuous dry support, hazard and unknown-geometry checks, stopping margin, cancellation and control ownership.

## 0.5.7-rc.160-preview.37

- Retain real cooldown refusals in the bounded server feedback facts; share scaffold eligibility and effective movement policy.

## 0.5.7-rc.160-preview.36

- Unify scaffold material assessment across policy, native navigation and placement. Report unsupported configured materials separately from explicit disable, preserve authorized material selection, expose effective movement policy to journey consumers and export the shared assessment.

## 0.5.7-rc.160-preview.35

- Wait for the current native landing/physics epoch before starting environment or damage reflexes. Positive respawn health alone no longer turns stale fire/water cells into a new rescue and body-queue hold; normal rescue resumes after fresh position and physics evidence.
- Apply the same landing boundary to explicit spatial observations, so a tool cannot return an old-location frame while the current snapshot says the body is unverified.
- Add on-demand `mc_bag {detail:"slots", item?}` for exact self inventory window slots, stack counts, names, durability and enchantments. Read the original player window without moving items or running scripts; distinguish unsynchronized inventory, container slots, equipment and the hotbar. Keep summary reads compact and refresh slot-sensitive reads even when aggregate counts have not changed.

## 0.5.7-rc.160-preview.34

- Keep bounded native failure, observed-effect and spatial-coverage evidence in explicit queue reads; export a reusable compact execution summary. Export pure checkpoint content evidence for hosts: compare matched query payloads and spatial revisions without transport-clock/ID churn, preserve domain facts, and distinguish pending or entirely unknown observations from new content. Novel content is not verified goal progress.

## 0.5.7-rc.160-preview.33

- Return fast matched read-only server replies in the original World tool invocation, with a bounded 350 ms observation window. Preserve synchronous SDK calls, pending IDs, provenance, timeout/cancellation and concurrent body actions; never resend queries.

## 0.5.7-rc.160-preview.32

- Diagnose the requested exact feet/head cells independently of open neighbours. Report measured full-cube obstruction before a futile navigation wait when no complete route exists; preserve unknown/partial shapes and explicit terrain-editing routes.

## 0.5.7-rc.160-preview.31

- Preserve complete short system/plugin notices in requested message results, including confirmation identifiers; keep resident indexes and long-message previews compact.

## 0.5.7-rc.160-preview.30

- Retry a briefly locked atomic request-receipt replacement within 75 ms. Never re-execute the tool, delete the prior pending record, or hide a persistent storage fault.
- Declare selectable current-fact partitions independently of optional or disconnected observations. Absent values remain unknown; no previous body state is restored and no empty data enters the factual context.
- Add explicit absolute orientation to short control steps, using the spatial observation coordinate frame. Relative turns remain the default; collision, body ownership, cancellation and measured movement receipts are unchanged.

## 0.5.7-rc.160-preview.29

- Keep server-attested role and verified ownership beside personal names in compact observations and nearby tracking. Display names and protocol targets remain unchanged; a name alone does not establish identity, friendliness, ownership or life state.
- Classify structured server failures by their result fields, before preview truncation. Skill restrictions, historical failures and nullable error fields in successful state/help replies no longer populate the recurring error ledger. Original server events remain available.

## 0.5.7-rc.160-preview.28

- Pair authored game speech with attested nearby text, sent while audio is synthesized. Preserve a shared request ID, durable text/audio outcomes and existing chat delivery events; never replay unknown sends or fall back to global/private chat. Uploaded audio may carry an explicit authored caption.
- Preserve body-action waits and native system evidence when sending ordinary conversation. Upload audio in bounded 64 KiB bursts, yielding for cancellation and connection events instead of sleeping after every 16 KiB packet. Record synthesis/upload/server-state timestamps separately from actual hearing.
- Prefer server-attested personal names over decorated protocol names in compact entity observations; retain raw identity, ownership and entity types.

## 0.5.7-rc.160-preview.27

- Carry UUID-correlated server entity identity through snapshots, proximity and death events, attention, find results, and public SDK observations. Keep raw protocol types and targeting unchanged; never infer ownership from custom names or rename a player from an NPC identity.
- Scope identity resolvers to a single connection, including read-only observation facades. Preserve explicit occlusion and use entity-tracking provenance instead of invented sounds for nearby non-hostile entities.

## 0.5.7-rc.160-preview.26 (unpublished candidate)

- Recheck native offered combat steps after isolated program evaluation. If terrain changed, reject this frame's steps with `programDeferred: scene-changed` and evaluate again on the next fresh frame without disabling the authored program. Invalid authored geometry, actual program failures and execution-time safety checks remain unchanged in Mineflayer and Java.
- Expose the distinction between host-choice programs and automatic spell rules in the tactic readout. Mana conservation must change the relevant automatic rule; candidate order alone cannot prove a change in automatic casts.

## 0.5.7-rc.160-preview.24 (unpublished candidate)

- Keep concurrent battlefield reads from disabling an Agent-authored combat program. Contended readers retain fresh default candidates and report `programDeferred`, without borrowing another frame's policy or masking real failures.
- Measure multipart query limits in UTF-8 bytes so Chinese replies cannot exceed the bounded aggregate or final envelope.
- Integrate reviewed supervisor context, named NPC observations, weapon capabilities and multipart server queries with the Numen body adapter. Keep host-authored actions and original receipts authoritative.
- Confirm actual enchanting results before reporting success; provide exact failed-skill usage and preserve partial query evidence without automatic retries.

- Add source-authored supervisor event views through `agent-mc-world/context`. Accepted tactical choices expose a bounded summary linked to the exact original payload; missing or mismatched views retain full evidence. Rejected choices and unknown outcomes stay complete.
- Declare tool-help targets through an optional `helpFor` capability so host supervisors can route execution-contract discovery to task workers without copying or guessing tool names. SDK/MCP execution and original event delivery remain unchanged.
- Preserve protocol-observed custom names and UUIDs for named non-animal entities in visual facts and interaction receipts, without changing their target type or inferring ownership.
- Deliver named neutral and owned-pet deaths with structured identity and an appropriate wake-up trigger; ordinary combat-target receipts retain their existing ownership and notification behavior.
- Stop treating NPC button interfaces carried by generic chest packets as evidence of an accessible inventory. Keep verified vanilla container-entity readouts separate from unknown interaction menus.

## 0.5.7-rc.160-preview.18 (unpublished candidate)

- Expose argument-specific SDK/MCP call capability inspection using the original schema and canonical predicates; inspection does not execute, acquire the body or authorize a later call.
- Preserve typed work identities, revisions and native world observations through SDK facts. Match work references through the same public resolver for MCP consumers; disconnected/stale/conflicting observations never close host tasks automatically.

## 0.5.7-rc.160-preview.17 (unpublished candidate)

- Reconstruct coordinate-dependent dripstone and bamboo collision shapes using the same calculation as the live body. Validate recorded shapes at their original positions, including external terrain updates; reject forged or relocated geometry.

## 0.5.7-rc.160-preview.16 (unpublished candidate)

- Separate offline method validation from live execution, preserving native body ownership and original pending calls during background learning.
- Expose explicit background-learning capability branches for immutable method edits and Harness² practice; preserve live execution and adoption evidence boundaries.
- Capture scoped immutable local scenes through the script discovery entry and reconstruct Java 1.21.1 collision practice with original pose, velocity, verified block states and external terrain events. Unknown cells stop trials; renamed identical captures are not independent holdouts. Combat, oxygen and server plugin effects remain unsupported.
- Bind Harness² admission and terminal notifications to one execution identity for asynchronous waiting, and allow explicit recorded training/holdout selection.

## 0.5.7-rc.160-preview.15 (unpublished candidate)

- Honor Agent-authored combat observation radii beyond 16 blocks end to end; do not invent upper bounds for RPG mana or observed enemy-count predicates. Spell availability, body ownership, actual tracked entities and cooldown checks remain authoritative.
- Return the exact invalid rule field and condition, preserving the previous tactic when a revision is rejected.

## 0.5.7-rc.160-preview.14 (unpublished candidate)

- Explicit host-selected engagement can approach visible targets within 32 blocks without expanding passive automatic engagement. Preserve the selected target while approaching, weapon checks and scene cancellation.
- Offer a cancellable two-to-three-block idle stroll through the existing decision/body controller on verified flat ground. Do not offer it during work, interaction or nearby hostile presence; recheck danger and ground during movement.
- Publish current body phase with stable elapsed time and expiring freshness to public viewers independently of model activity. These display records neither add prompt context nor report task completion.

## 0.5.7-rc.160-preview.13 (unpublished candidate)

- Require actual fire/lava contact before environment rescue takes the body away from combat; residual burning near an unrelated hazard no longer repeatedly cancels combat or eating.
- Expose independent retaliation and navigation jump policy through the existing SDK/MCP policy tool. Default to full, level one-cell gap jumps, with explicit off/native alternatives and unchanged collision/landing guards.
- Label biome telemetry as terrain classification, not an asserted named venue or movement.
- Includes preview.12 ranged target ownership, acquisition and decision-label fixes.

## 0.5.7-rc.160-preview.11 (unpublished candidate)

- Return a bounded first page from oversized solid-box probes instead of discarding the entire observation. Partial receipts keep real matches, unknown cells, exact unread regions and explicit absolute-coordinate follow-up calls; no automatic continuation or relaxed write limits.
- Include upstream activity attribution contracts; attribution alone remains separate from versioned completion evidence.

## 0.5.7-rc.160-preview.9 (unpublished candidate)

- Select an existing workstation with a confirmed walking route before trying closer stations behind floors or walls. Use the same interaction reach for route probes and execution, preserving unknown routes, cancellation, native inventory confirmation and movement ownership.
- Use workstations already within interaction reach without demanding an unnecessary two-block landing. Keep route planning bounded and restore movement settings after each attempt.

## 0.5.7-rc.160-preview.8 (unpublished candidate)

- Separate pre-authentication proxy health from genuine game death recovery so login zero-health packets do not hide a synchronized inventory.

## 0.5.7-rc.160-preview.7 (unpublished candidate)

- Correct Java 1.21.1 inline armor trim and food component layouts so a single customized item cannot shift every following inventory slot. Preserve protocol-specific 1.20.6, 1.21.3 and 1.21.4 compatibility.
- Surface complete player-inventory packet decode failures separately from initial synchronization. Reject partially consumed inventory packets, retain old data as unconfirmed, and recover only on a new complete player snapshot. Do not reconnect, replay inventory mutations or infer empty slots.

## 0.5.7-rc.160-preview.6

- Keep executable per-call read predicates in the parent process and send only serializable extension descriptors to the engine child. Exercise the real child channel through SDK/MCP.

## 0.5.7-rc.160-preview.5 (unpublished candidate)

- Expose strict per-call read classification for combat tactic, battlefield, decision and report queries across SDK, IPC and Java clients. Mixed read/update requests remain mutations; hosts can permit evidence collection alongside a body-owning worker without granting tactic writes.
- Accept finite absolute RPG health thresholds above 20, including fractional values, in tactic validation, persisted settings and rule schemas. Availability, mana, cooldown and body ownership checks remain unchanged.

## 0.5.7-rc.160-preview.4 (unpublished candidate)

- Preserve death episode identity, ledger count and independently timestamped recovery health while spatial readiness is unavailable. Distinguish an authenticated connection from missing respawn position; never promote health alone to a valid landing.
- Log native body boundary, first position and first physics transitions without per-frame noise, to support protocol diagnosis. This does not fabricate missing packets or force a reconnect.

## 0.5.7-rc.160-preview.3

- Project inventory organization previews into compact slot/count/variant views. Keep exact NBT/component identities for execution preconditions and conservation checks, rather than repeating them in model-facing results. Export the preview through SDK and extension contracts.
- Retain the Java 1.21.1 codec and earlier navigation repairs from the preceding candidate. Not yet loaded or published.

## 0.5.7-rc.160-preview.2 (unpublished candidate)

- Restrict the obsolete food-component workaround to Java 1.20.5/1.20.6. Preserve the real 1.21.1 usingConvertsTo field so native inventory packets containing custom food do not lose their following component/slot boundaries. Verify through the real protocol decoder and Mineflayer inventory plugin.
- Apply the potion custom-name workaround only to the known affected versions, preserving newer wire fields.

## 0.5.7-rc.160-preview.1 (unpublished candidate)

- Delay first World activation until both authentication and configuration transport readiness hold. A proxy can confirm authentication before the backend's first PLAY position; retry activation after that native position so the World sees its connected bot and installs query, perception and body lifecycle listeners exactly once.

## 0.5.7-rc.157-preview.1 (unpublished candidate)

- Keep the native map identity in sites, rays and voxel receipts, including the compact readout prefix. Distinguish equal coordinates in different maps sharing the same dimension type; missing map identities remain unknown.

## 0.5.7-rc.153

- Pin Zod 4.6.6 to include the oversized-collection validation memory fix (GHSA-mrhx-c7xc-m3w5).

- Publish validated physical readiness, durable state recovery, nutrition and journey review, current rejected-command advice, and optional host-owned visual decision contracts.
- Preserve host-owned personas, credentials, goals, memory and optional server integration; source publication does not reload existing clients.

# Changelog

## 0.5.7-rc.155-preview.1 (unpublished candidate)

- Invalidate current body/spatial facts while native landing or physics evidence is missing. Request facts and deferred snapshots retain goals and historical terminals, but do not expose the old location, equipment, surroundings or decision candidates as current readings.
- Suppress proximity and gesture observations based on that stale body; resume ordinary reads after a real server landing and native physics tick. Preserve transport/chat and the no-automatic-replay policy.

## 0.5.7-rc.154 (unpublished candidate)

- Expose the connected crafting experiment as an explicit host-model entry, reusing SDK/MCP, dedicated clients, original executor and MethodLibrary; keep the scripted verifier separate.
- Supply bounded original action rejection feedback with training inventory/health evidence. Require failed training evidence in real-mode model inputs, preserve source revision and independent holdouts, audit model attempts/known tokens and report measured work without inventing a monetary charge.
- Add no-connection preflight and cancellation/failure evidence. No live profile, method adoption, npm publication or real-model/server success claim.

## 0.5.7-rc.148

- Wire the existing Harness² practice service into the core SDK/MCP tool catalogue, request facts, completion events, console monitor and disconnect/reconnect lifecycle. Hosts explicitly supply the model, worker and isolated execution port; unconfigured help reports unavailable without starting anything.
- Add `createClientMethodPractice`: execute through a dedicated connected client's existing `mc_script` and canonical MethodLibrary, independently read complete inventories, retain original UUIDs/call evidence, and fence unresolved trials across restart. No copied game executor or automatic adoption.
- Include an explicit two-vanilla-server integration verifier covering actual crafting, independent holdouts, MCP discovery/start/result/cancel and service reconstruction. Real-model quality and production deployment remain separate acceptance steps.

## 0.5.7-rc.147

- Use the same interaction-reach approach for coordinate-targeted withdrawals, pinned furnaces and brewing stands, and enchanting tables as ordinary container activation. A container already within reach no longer requires an unnecessary two-block landing. Preserve cancellation, native window admission, item transfer accounting and post-operation confirmation.

## 0.5.7-rc.146

- Distinguish a no-progress route with no native movement or motor commands from a collision while walking. End the stalled owned route with planning evidence rather than running an irrelevant unwedge or claiming the player/server is frozen. Retain actual movement/work stalls, deadline, cancellation and unknown readings.

## 0.5.7-rc.145

- Continue surface-only swim routes without demanding an unrelated full-oxygen refill at every waypoint. Confirm a refill before the next submerged leg and maintain bounded surface input while waiting; preserve unknown oxygen, cancellation and incomplete results.
- Keep water-travel discovery visible while the feet remain in water and the head is breathing. Report head submersion separately and expose the existing continuous `swim` action alongside short controls and agent-authored programs.

## 0.5.7-rc.144

- Use the existing four-block interaction reach throughout a block-approach route, rather than requiring a second two-block arrival goal after the route starts. Keep cancellation, native hand preparation and effect verification unchanged; prevent needless approach failures at chests and ledges.
- Retain countdown ticks in live HUD facts while publishing status-bar stage changes and progress bands. Preserve objective counts, coordinates, appearance/removal and boss damage signals instead of flooding language-model event history every second.

## 0.5.7-rc.143

- Support an explicit host-owned MCP turn boundary. Enforce the same operation subset in execution, discovery and environment text; retain standalone caller-owned turns and the host SDK lifecycle.

## 0.5.7-rc.142

- Expose a pure conservative partition for independent body suffixes behind leading social speech. Preserve explicit queue order, cross-step dependencies, commands and native admission.
- Include the existing parameter error path, expected field and validated example in text receipts, so text-only host projections retain the correction without loading every skill contract.

## 0.5.7-rc.141

- Include the public server-tool and equipment source entries already declared
  by the canonical build receipt in npm archives.
- Verify every declared source input in installed-package checks, so a working
  runtime cannot conceal an incomplete source inventory. Runtime behavior is
  unchanged from rc.140.

## 0.5.7-rc.140

- Expose the existing verified food-risk reference through public SDK/extension exports and live backpack, food-reserve and low-health facts.
- Keep concrete explicit-meal preflight cautions even without safe alternatives. Retain requested items, soft warnings and actual post-consumption effects; do not add a blanket risky-food prohibition.
- Share the routine risk catalogue with familiar-action recognition and retain safe raw food and the existing emergency fallback.
- Integrate the latest upstream explicit no-action decision-review contracts without removing the deployed rc.139 capability line.

## 0.5.7-rc.131

Keep the existing server/account/agent binding for optional memory-service workflows across native map changes. Local spatial notes retain their separate native-map namespaces and captures include native world identity. Preserve ownership rejection and pending-correction checks; do not rebind or rewrite existing memory ledgers.

## 0.5.7-rc.130

Keep durable goal intentions scoped to server/account/agent across native map changes; map-specific runtime proof is re-read. Preserve the original checkpoint namespace instead of silently replacing it when upgrading world identity isolation.

Add optional nearby voice through the existing authenticated connection, canonical standalone/SDK helper, native-world/authentication gating, same-ID recovery and separate game/livestream outputs. Reuse one audio artifact and preserve current voice/provider in the presentation extension. Retain real UUID/utterance provenance in a separate nearby-voice inbox channel. Include the latest upstream native-world isolation and the previously prepared reliability fixes.
## 0.5.7-rc.139

- Integrate main and the deployed rc.137 client capability line without changing server code.
- Preserve proximity voice, chat audience evidence and memory-service identity alongside main's plan, command and measured-motion review.
- Publish configured read-only query IDs and structured argument discovery from the same protocol definitions used to dispatch commands.
## 0.5.7-rc.160-preview.20 (unpublished candidate)

- Separate a desired heal/low-health observation from actual exclusive survival body ownership. Fast withdrawal stays available while healing is cooling down; native engagement health gates remain enforced.
- Feed real sound bearings and expiring last-seen hostile locations into fast decisions. Optional checked short search steps reuse the existing executor and never attack an occluded entity or follow its hidden live coordinates.
- Share full-report receipts, revision/idempotence review inspection and native execution wait reduction through public contracts, SDK and MCP. Preserve host stage checks and scheduling; caller-supplied evidence never becomes verified game completion.
- Native terminal receipts dominate admission callbacks regardless of arrival order; isolate waits by exact world/kind/id and host lifetime, preserving ambiguity and unknown effects.
- Include the independent speech/body capability from preview.19; voice keeps its existing queue and request identity without taking a movement worker's body lease.
## 0.5.7-rc.160-preview.53

- Treat server-confirmed mounting separately from death or world changes. Retain the verified position epoch while Mineflayer suspends walking physics, including reconnect packet ordering, without trusting stale vehicle pointers.
- Add the optional `boat_trip` script for observed placement, exact-entity mounting, bounded waypoints, checked shore landing and verified empty-boat recovery. Preserve cancellation, single-body ownership and partial results.
- Keep current water-travel choices ahead of large terrain details in route decisions; expose the new script and recovery contract through the shared SDK/MCP help.
