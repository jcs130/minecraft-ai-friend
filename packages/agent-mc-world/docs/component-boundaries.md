# Minecraft component boundaries

`agent-mc-world` is the primary product and single owner of general Minecraft
Agent capabilities. Different models and hosts reuse the same implementation
through its SDK, MCP and public extension ports. A host is the application running
an Agent: for example Cortico or DSH. Hosts supply personality, personal long-term memory,
goals, model connections and decisions. A host adapter translates their tool,
event and lifecycle interfaces; it must not maintain another game implementation.

| Component | Owns |
| --- | --- |
| `agent-mc-world` | Connections, inventory/crafting and GUI state, navigation, water/flight controls, following, combat execution, perception/information discovery, scripts/skill libraries, body leases, cancellation, task terminals and evidence receipts |
| `agent-mc-world/tactics` | Native battlefield observations, bounded candidate generation, authored tactic workers, ability state, rules, versioned tactic storage and encounter receipts |
| `agent-mc-world/decisions` | Optional host-side selector helpers, explicitly constructed and started by a host; the game process never starts them |
| `agent-mc-world` game memory | Server/account/agent isolation, historical notes, revisions and evidence, local keyword/vector retrieval and explicit external memory providers; no host personal-memory import or hidden planning loop |
| `agent-mc-world` learning mechanisms | Versioned methods, operation evidence, explicit reflection/retrieval/evaluation, links between decisions/adoption/execution, negative evidence and revision/rollback records; hosts/models choose and adopt methods |
| Host adapter | Tool/event names, host model connection selection, lifecycle forwarding and configuration UI |
| Optional server pack | Server command syntax, authenticated custom protocols, ability catalogues and game-specific rules/guides |
| `mc-visual-console` | Shared renderer source and visual assets; the core consumes a versioned build |

## Core-first delivery

1. Classify the capability by meaning, even when a need first appears in Cormy or
   a host plugin. General Minecraft behavior belongs in the core; server command
   formats and custom rules belong in explicitly selected server packs.
2. Implement and test the common behavior once in the core, including its facts,
   contracts, help, receipts and backend capability declarations. Do not copy it
   into each adapter or require a particular model, persona or server.
3. Export it through the appropriate public SDK/MCP/extension ports and verify
   packed consumers in isolation. Keep backend limitations and unknown state
   explicit; a shared tool name alone does not prove equivalent execution.
4. Update consumer pins and thin mappings after the core is ready. Source,
   package, deployment and live effects remain separate evidence stages.

Learning mechanisms and skill libraries follow the same ownership rule. The
core makes them reusable; a host/model supplies reasoning, authors candidates
and decides what to adopt. Saving code or a receipt does not establish an
improvement. Personal memory, model credentials and VTuber TTS/music remain
outside the generic game toolkit.

## Generic tactics are available without a server pack

The default SDK/MCP client exposes `mc_combat_tactic`, and its default child
factory constructs `TacticalMinecraftWorld`. Installing Qiandengji is unnecessary
for battlefield sampling, authored programs, validated engagement/steps or combat
receipts. No vanilla spell is invented: default ability catalogues are empty,
mana remains unknown, and the base execution hook sends no spell command.

`CombatAbilities` stores observed ability state and evaluates rules. A server
pack may subclass it to decode its own messages and provide explicit fallback
defaults. `TacticalMinecraftWorld` rechecks body ownership, current revision,
connection generation, targets and collisions before executing a submitted choice.
Party telemetry is listened to only when an extension supplies a channel.

Hosts can construct `HostCombatDriver` from `/decisions` and supply their saved
decision connection through its `decisions.request` port. The separate optional
host service also retains the explicitly configured endpoint compatibility path.
Importing it starts no requests; shutdown cancels pending choices. None of its
endpoint or credential configuration is passed into the game process.

## Extension compatibility

Server extensions use public exports, never `node_modules/.../core` paths or a
neighbouring source checkout. The low-level `MinecraftWorld` extension base remains
available; extensions requiring tactical execution derive from the public
`TacticalMinecraftWorld` and call inherited lifecycle hooks.

The 2026-10-14 extraction retains the existing `minecraft-combat-tactics.json`
version 1 format and realm keys, program source/hash, tactic revisions and last
five combat receipts. Former Qiandengji module paths re-export the core during
migration. They contain no second implementation or worker.

The former independent headless distribution's `agent_mc:break_acl` channel and
`agent-mc-realm.json` marker are accepted by the canonical core, alongside the
legacy protocol/marker. An existing independent marker takes precedence; neither
is automatically renamed or copied. This preserves data identity and permissions
without maintaining a second patched source tree. Historical migration helpers
remain opt-in exports; compatibility strings are not framework imports.

## Verification gates

- Full core tests, declarations, build hashes and isolated package installation.
- Generic SDK tool discovery and a real IPC child can install/read/restore a
  tactic with the server connection disabled and no server pack installed.
- Server and host packages resolve the same installed core; legacy exports have
  the same class/function identities as public core exports.
- Installing a package does not establish live gameplay improvement. Deployment,
  state preservation and actual inventory/game results are recorded separately.

This extraction is maintenance work, not an Agent-authored learning result.

## Completed tasks with no observed effect

`taskEffectProgress` reports measured task and work effects separately from the
terminal state. A completed `goto` followed by a `pickup` noop remains completed;
it does not prove an inventory gain or the Agent's goal. Moving to the collection
site cannot erase a repeated no-effect pickup episode. `PlanReviewBook` correlates
these episodes with accepted task IDs, retains unknown measurements, and clears
them when measured work changes. Hosts may use this evidence in their existing
reflection policy without starting another model loop.

`NoEffectPlanBook` gates only a new, identical choice after comparable completed
noops. The executor currently supplies complete comparison context for pickup
batches with optional navigation, looking and waiting: dimension, position,
inventory, window, loaded navigation targets and existing item entities within
the pickup skill's 24-block range. New item/state observations permit a fresh
attempt. Missing comparison fields and other action/backend coverage remain
unknown; they cannot authorize a refusal. This is not a fixed retry timer or
proof that the requested goal failed.

A known no-effect refusal preserves all prior terminals, queue ownership and
unknown effects. Its typed admission references the original task for inspection
and ends only the current decision turn. The host retains the original goal and
chooses another action or a real waiting condition. The gate neither cancels work
nor replays a pending request, invents a successful outcome, or changes personality,
memory or model settings.

Success reports use the existing explicit `needs` contract. For example, a chat
following pickup uses `needs:[1]`, and a report after a dependent toss refers to
that toss step. Failed, skipped and noop upstream steps do not release such a
report. `partial` still requires reading the actual quantity; neither a thrown
item nor a sent chat proves that another player received it. An independent
request for help can use `needs:[]`. The executor does not infer a chat's intent
or truth from its wording, and a chat's `ok` result never constitutes material
progress. This distinction applies through the shared SDK, MCP and host ports.

Retained-body adapters import `causalNeeds`, `sampleEffect`, `observedEffect`,
`taskEffectProgress` and `NoEffectPlanBook` from `agent-mc-world/client`, with
`SkillCall`, `StepOutcome`, `EffectSample`, `ObservedEffect` and
`EffectSampleOptions` types from the same export. These are the core's existing
implementations, not a second executor. `causalNeeds` infers material edges only;
the body still honors explicitly declared `needs` (including independent `[]`),
spatial admission and its own step outcomes. It does not infer chat semantics.
A retained body passes `inventoryReady:false` to `sampleEffect` until its own
server slots and click outcomes are confirmed; unavailable observations stay
unknown. Merely importing helpers does not install these ports or validate live
behavior: the host must wire per-step capture, real dependency gating and
selection review into its sole queue, without changing unknown effects.
