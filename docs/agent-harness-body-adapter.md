# Agent harness — unified body adapter (`agent-mc-body/v1`)

Status: implemented in `packages/agent-harness/src/body/` on `feat/agent-harness-phase1` (local branch only).
Everything the harness does to a body — the `BodyPort` executor, the planner's step validation, the gateway's
`welcome` / `get_body` / step checks, the summary line and memory observation — goes through one interface, `BodyAdapter`.
Three bodies implement it, each by **importing** the existing client/bridge code:

| body | adapter | wraps (imported, not copied) |
| --- | --- | --- |
| Mineflayer (`packages/agent-mc-world`) | `src/body/mineflayer.ts` `MineflayerBodyAdapter` | `MinecraftAgentClient` (`mc_do` / `mc_observe` / `mc_bag` / `mc_stop` / `task`), `parseSteps`, `SKILL_NAMES`, `SKILL_STEP_SCHEMA` |
| Numen, hosted (`paper/integrations/numen-hosting`) | `src/body/numen.ts` `NumenBodyAdapter` + `numenHostedAdapter()` | agent-mc-world `NumenBodyPort` contract; numen-hosting `HostedRoles` → `numenCorePort()` (`core-port.mjs`) → `hosted_body` |
| Numen, owner companion channel (`paper/integrations/mcbot`) | `src/body/numen.ts` + `src/body/mcbot-port.ts` `McbotNumenPort` | the same `NumenBodyPort` contract, over the owner's agent-mc-world connection (`mcbot:c2s` / `mcbot:s2c`) |
| Touhou Little Maid (`paper/integrations/touhou-maids`) | `src/body/maid.ts` `MaidBodyAdapter` | `createMaidPort`, `MAID_TOOL` from `agent/maid-port.mjs` (`qiandengji-maids/v1`) |

Safety is a decorator over any adapter: `guardBody(adapter, options)` (`src/body/safety.ts`).

## Interface (`src/body/types.ts`)

Verbs: `move`, `follow`, `stop`, `look`, `chat`, `interact`, `use_item`, `attack`, `mine`, `collect`, `place`, `craft`, `smelt`, `equip`, `eat`, `drop`, `pickup`, `transfer`, `flee`, `wait`, `observe`, `inventory`, `command`, `recall`, `stay`, `sit`, `cast`, `native``.
Event kinds: `chat`, `whisper`, `system_message`, `player_join`, `player_leave`, `death`, `respawn`, `health`, `hunger`, `effect`, `level`, `position`, `dimension`, `inventory`, `entity`, `combat`, `action_progress`, `action_result`, `snapshot`, `status`, `server_status`, `connection`, `lifecycle`, `dialogue`, `safety`, `other``.

```ts
export interface BodyWorldRef {
  /** Server / realm id (stable across reconnects). */
  serverId: string | null;
  /** Exact level key when the body reports one (e.g. minecraft:overworld, a dungeon instance key). */
  worldKey: string | null;
  dimension: string | null;
}

/** Identity + isolation scope. `scope` is what memory/intents are partitioned by; never derived from chat text. */
export interface BodyIdentity {
  kind: BodyKind;
  /** Stable body id: Mineflayer account, Numen role UUID, maid UUID. */
  bodyId: string;
  name: string | null;
  /** Owner of a companion body (Numen owner / maid owner UUID); null for a plain player account. */
  ownerId: string | null;
  world: BodyWorldRef;
  scope: { realm: string; account: string; agent: string };
  /** Connection/control generation (epoch, body_id, connection run). Changes on reconnect/handoff. */
  generation: string | null;
}

export interface ActionSupport {
  /** The body's own operation this verb maps to (for docs/debugging), e.g. `mc_do:goto`, `move_to`, `/qdmaid follow`. */
  native: string;
  /** Accepted actions finish later with an `action_result` event (and `result(requestId)`). */
  async: boolean;
  /** Argument names understood for this verb. */
  args: string[];
  notes?: string;
}

export interface NativeActionInfo { name: string; description?: string; readOnly: boolean; schema?: Record<string, unknown> }

export interface BodyCapabilities {
  protocol: typeof BODY_PROTOCOL;
  kind: BodyKind;
  /** Transport actually in use (e.g. `agent-mc-world`, `numen-hosted`, `mcbot`, `maid-plugin-message`). */
  transport: string;
  actions: Partial<Record<ActionVerb, ActionSupport>>;
  /** Body-specific operations reachable with `{ verb: 'native', name, args }`. */
  nativeActions: NativeActionInfo[];
  events: BodyEventKind[];
  /** Snapshot fields this body can actually fill (others stay null). */
  snapshot: Array<'position' | 'dimension' | 'health' | 'food' | 'inventory' | 'entities' | 'lifeState' | 'text'>;
  lifecycle: { spawn: 'connect' | 'attach' | 'summon' | 'bind-existing'; reconnect: boolean; destroy: 'disconnect' | 'release' | 'dismiss' | 'detach' };
  /** How events are produced: pushed by the body, or sampled by the adapter. */
  perception: 'push' | 'poll' | 'push+poll';
  safety: { antiCheatStop: boolean; paceLimits: boolean; nativeGuards: string[] };
  /** Honest limitations shown to planners/hosts. */
  limits: string[];
}

export type BodyLifecycleState = 'detached' | 'spawning' | 'ready' | 'reconnecting' | 'dead' | 'destroyed' | 'error';

export interface BodyAction {
  verb: ActionVerb;
  args?: Record<string, unknown>;
  /** For verb `native`: the body-specific operation name (see capabilities().nativeActions). */
  name?: string;
  /** Caller-chosen idempotency key ([A-Za-z0-9_-]{8,48}). Never reused for another action; unknown results are never re-sent. */
  requestId?: string;
}

export type ActionStatus = 'completed' | 'accepted' | 'failed' | 'rejected' | 'unsupported' | 'blocked_by_safety' | 'unknown';

export interface ActionReceipt {
  requestId: string;
  verb: ActionVerb;
  status: ActionStatus;
  /** True when no further `action_result` will follow. */
  terminal: boolean;
  text: string;
  /** Body execution id to wait on (agent-mc-world task id, Numen request id, mcbot job id, maid operation id). */
  executionId?: string;
  data?: unknown;
  /** Always false: an uncertain write must be reconciled with `result()`, never replayed. */
  retryAllowed: false;
  retryAfterMs?: number;
}

export interface BodySnapshot {
  sampledAt: string;
  lifeState: 'alive' | 'dead' | 'unknown' | 'unloaded';
  position: { x: number; y: number; z: number } | null;
  dimension: string | null;
  health: number | null;
  maxHealth: number | null;
  food: number | null;
  inventory: unknown | null;
  entities: unknown | null;
  /** Human-readable observation (body's own wording). */
  text: string | null;
  raw?: unknown;
}

export interface BodyEvent {
  kind: BodyEventKind;
  at: string;
  bodyKind: BodyKind;
  bodyId: string | null;
  text: string;
  severity: 1 | 2 | 3;
  data: Record<string, unknown>;
  /** Execution receipt for action_progress/action_result (agent-mc-world ExecutionReceipt shape). */
  execution?: { kind: string; id: string; phase: string; terminal: boolean };
  /** The original body event (agent-mc-world EventEnvelope, maid envelope, mcbot packet …). */
  raw?: unknown;
  /** Lazy facts for memory scoping (agent-mc-world `requestFacts`, or derived from identity). */
  facts?: () => unknown;
}

export interface BodyHealth {
  kind: BodyKind;
  lifecycle: BodyLifecycleState;
  connected: boolean;
  since: string;
  lastEventAt: string | null;
  lastActionAt: string | null;
  counters: { actions: number; completed: number; accepted: number; failed: number; unknown: number; unsupported: number; safetyBlocked: number; events: number; errors: number };
  /** Last error text (never contains secrets: adapters only hold references to tokens, never values). */
  lastError: string | null;
  safety?: { halted: boolean; reason: string | null; since: string | null };
  extra?: Record<string, unknown>;
}

/** The unified surface every body implements. */
export interface BodyAdapter {
  readonly kind: BodyKind;
  identity(): BodyIdentity | null;
  capabilities(): BodyCapabilities;
  lifecycle(): BodyLifecycleState;
  /** Bring the body under control (connect / attach / summon / bind). Never creates a second body for the same identity. */
  spawn(signal?: AbortSignal): Promise<void>;
  reconnect(signal?: AbortSignal): Promise<void>;
  /** Release control. Never deletes a persistent companion. */
  destroy(): Promise<void>;
  act(action: BodyAction, signal?: AbortSignal): Promise<ActionReceipt>;
  /** Reconcile an earlier request without re-executing it. */
  result(requestId: string, signal?: AbortSignal): Promise<ActionReceipt>;
  stop(reason?: string): Promise<ActionReceipt>;
  snapshot(signal?: AbortSignal): Promise<BodySnapshot>;
  subscribe(listener: (event: BodyEvent) => void): () => void;
  health(): BodyHealth;
}
```

### Semantics every adapter keeps (enforced by `BaseBodyAdapter`, checked by the contract suite)

1. **Refuse before sending.** Validation order: requestId format → known verb → earlier receipt with the same requestId
   (returned as-is, nothing re-sent) → `connected` (`rejected`) → capability / native name (`unsupported`) → argument
   shape (`rejected`). Only then does the body see a write.
2. **No replay.** `retryAllowed` is always `false`. A write whose outcome is uncertain is `unknown`; callers use
   `result(requestId)`, which reconciles via the body's own query (agent-mc-world `task`, Numen `result`, maid
   `result`/`context`) or the adapter ledger. This matches maid-port (`send_uncertain`), numen-hosting (`opaqueId`) and
   agent-mc-world (`queued_or_running` is not a failure).
3. **Async actions.** `accepted` + `executionId`; one terminal `action_result` event follows (with an agent-mc-world
   `ExecutionReceipt`-shaped `execution`), and `result()` turns terminal.
4. **Lifecycle never creates or deletes a persistent companion.** Numen `spawn` = attach / summon an existing companion;
   maid `spawn` = bind an already-owned maid (list/context), never `create`; `destroy` = detach (mcbot `dismiss` only
   when `dismissOnRelease` is set — that is Numen's sleep, inventory kept).
5. **Identity/world isolation.** `identity().scope = {realm, account, agent}` comes from configuration and body
   metadata (server id, role UUID, maid UUID, owner UUID), never from chat text. `generation` changes on reconnect /
   hosted epoch / mcbot `body_id`. `toMcEvent()` gives non-Mineflayer events identity-derived facts (world key + experience
   scope) so agent-memory partitions them like Mineflayer events.
6. **Capability discovery + graceful degradation.** `capabilities()` lists only what is wired. The planner
   (`ExplicitStepsPlanner`) and gateway (`checkSteps`) refuse a `body:<verb>` / `body:native:<name>` step the body lacks with
   a reason, and legacy `mc_*` steps on a non-Mineflayer body; the intent goes to `needsHost` instead of failing in the body.
   Numen verbs are enabled only when the body's own catalog lists the tool.

### Safety hooks (`guardBody`)

* **Anti-cheat warning stop.** `system_message` / `server_status` text (and anything fed through `feedServerText()` from
  the owner's connection) is matched with agent-mc-world `isMiningWarningText` + `MINING_LIMIT_DEFAULTS` (same patterns as
  the mining limiter, default confirm pattern `你|检测|禁止|VL`). A hit: emits `safety` (severity 3), calls `stop()`, and
  blocks motion verbs and non-read-only native operations with `blocked_by_safety` for the session (or `haltOnWarningMs`)
  until `clearHalt()`. The harness pauses the active intent (`needsHost`) and shows `安全停止中` in the summary.
* **Pace limits.** Token buckets per category (`motion` 30 burst / 6 per s, `dig` 40/8, `combat` 40/8, `chat` 12/3,
  `other` 120/20; overridable). Exceeding a bucket returns `rejected` with `retryAfterMs`; nothing is sent.
* **`beforeAction` veto** for host policy. Native guards of the bodies stay in force (agent-mc-world mining limiter /
  movement pace, Numen permissions and `hosted_body` fence/epoch, mcbot `Policy`, maid-port pacing + 8 pending).

## Capability matrix

`⏳` = asynchronous (accepted → `action_result`). `—` = not offered (refused before sending).

| verb | Mineflayer | Numen (hosted_body) | Numen (mcbot) | TLM maid |
| --- | --- | --- | --- | --- |
| `move` | `mc_do:goto | goto_player` ⏳ | — | `move_to` ⏳ | — |
| `follow` | `mc_do:follow` ⏳ | — | `follow` ⏳ | `/qdmaid follow` |
| `stop` | `mc_stop` | — | `cancel` | `/qdmaid stay` |
| `look` | `mc_do:look` ⏳ | — | — | — |
| `chat` | `mc_do:chat` ⏳ | `say` ⏳ | — | `/qdmaid speak` |
| `interact` | `mc_do:use (block/entity)` ⏳ | — | `use_block` ⏳ | — |
| `use_item` | `mc_do:use (item)` ⏳ | — | `use_item` ⏳ | — |
| `attack` | `mc_do:attack` ⏳ | — | `attack` ⏳ | — |
| `mine` | `mc_do:excavate (single block)` ⏳ | — | `break_block` ⏳ | — |
| `collect` | `mc_do:collect` ⏳ | — | `collect` ⏳ | — |
| `place` | `mc_do:build (single block)` ⏳ | — | `place_block` ⏳ | — |
| `craft` | `mc_do:craft` ⏳ | — | `craft` ⏳ | `/qdmaid make (workshop)` ⏳ |
| `smelt` | `mc_do:smelt` ⏳ | — | `smelt` ⏳ | — |
| `equip` | `mc_do:equip` ⏳ | — | `equip` ⏳ | `/qdmaid equip` |
| `eat` | `mc_do:eat` ⏳ | — | `consume` ⏳ | — |
| `drop` | `mc_do:toss` ⏳ | — | — | — |
| `pickup` | `mc_do:pickup` ⏳ | — | `collect` ⏳ | `/qdmaid pickup` |
| `transfer` | `mc_do:take | stow` ⏳ | — | `transfer` ⏳ | `/qdmaid transfer` |
| `flee` | `mc_do:flee` ⏳ | — | — | — |
| `wait` | — | — | `wait` ⏳ | — |
| `observe` | `mc_observe` | `hosted_body observe` | `status` | `/qdmaid context` |
| `inventory` | `mc_bag` | — | `inventory` | `/qdmaid inventory` |
| `command` | — | — | `command` ⏳ | — |
| `recall` | — | — | — | `/qdmaid recall` |
| `stay` | — | — | — | `/qdmaid stay` |
| `sit` | — | — | — | `/qdmaid sit` |
| `cast` | — | — | — | `/qdmaid cast` ⏳ |
| `native` | 59 ops | 6 ops | 20 ops | 33 ops |

Events (`perception`: Mineflayer push · Numen hosted poll · mcbot push+poll · maid push):

| event | Mineflayer | Numen (hosted_body) | Numen (mcbot) | TLM maid |
| --- | --- | --- | --- | --- |
| `chat` | ✓ | — | — | — |
| `whisper` | ✓ | — | — | — |
| `system_message` | ✓ | — | ✓ | — |
| `player_join` | ✓ | — | — | — |
| `player_leave` | ✓ | — | — | — |
| `death` | ✓ | ✓ | ✓ | ✓ |
| `respawn` | ✓ | ✓ | ✓ | ✓ |
| `health` | ✓ | ✓ | ✓ | — |
| `hunger` | ✓ | ✓ | ✓ | — |
| `effect` | ✓ | — | — | — |
| `level` | ✓ | — | — | — |
| `position` | — | ✓ | ✓ | — |
| `dimension` | ✓ | ✓ | ✓ | — |
| `inventory` | — | — | — | — |
| `entity` | ✓ | ✓ | — | — |
| `combat` | ✓ | — | — | — |
| `action_progress` | ✓ | — | — | — |
| `action_result` | ✓ | ✓ | ✓ | ✓ |
| `snapshot` | ✓ | — | — | — |
| `status` | ✓ | ✓ | ✓ | — |
| `server_status` | ✓ | — | — | — |
| `connection` | ✓ | — | ✓ | — |
| `lifecycle` | ✓ | ✓ | ✓ | ✓ |
| `dialogue` | — | — | — | ✓ |
| `safety` | ✓ | ✓ | ✓ | ✓ |
| `other` | ✓ | — | — | — |

| | Mineflayer | Numen hosted | Numen mcbot | maid |
| --- | --- | --- | --- | --- |
| spawn / destroy | connect / disconnect | attach / detach | summon / detach (dismiss opt-in) | bind existing / detach |
| reconnect | ✓ (`client.reconnect`) | ✓ (new epoch) | ✓ (`task_begin` again, new `body_id`) | ✓ (re-bind) |
| snapshot | position, dimension, health, food, inventory, entities, life, text (parsed from `mc_observe`) | text, position, dimension, health, food, life, entities (`facts`/`battlefield`) | text, position, dimension, health, food, life (`status`) | life, dimension, position, inventory, text (`context`) |
| `result()` source | `task` (agent-mc-world task ledger) | Numen `result` op + `workPending` | local job ledger (`job_event`) | maid `result` + chat-result envelope |
| native ops | `skill:<name>` (every `SKILL_NAMES` entry, with its schema) + `tool:mc_*` | `lua`, `say`, `skill`, `todo`, `memory`, `guide` (catalog) | the 20 mcbot tools | every `MAID_TOOL` action |

## Harness wiring

* `HarnessRuntime.attachBody(body, { execute })` subscribes to body events (→ `toMcEvent` → memory `observe`; `safety`
  and lifecycle/connection changes → harness `safety`/`body` events) and, with `execute`, binds `bodyAdapterPort(body)` as the
  exclusive `BodyPort`.
* Steps: `body:<verb>` (args as in the matrix), `body:native:<name>`, or legacy agent-mc-world tools (Mineflayer only).
  `mc_stop` / `body:stop` map to `stop()`.
* `withAgentHarness()` builds a `MineflayerBodyAdapter` wrapped in `guardBody`, passes `adapter.observer` to agent-mc-world
  `eventObservers`, and calls `attachBody` (observe only until the server binds execution). `serve.ts` uses `body.spawn()`.
* Gateway: `welcome.body` (kind, transport, lifecycle, verbs, native count, events) and `get_body { include }` →
  capabilities / health / snapshot (owner/scope only for admins; no raw). Unsupported steps → `bad_request`.
* Other hosts: numen-hosting can create `numenHostedAdapter({ hosting, role, epoch })` from `HostedRoles.harness.start`;
  N.E.K.O / DSH keep using agent-mc-world directly and can opt into the adapter through `withAgentHarness` (flag off by default).

## Reuse map

| need | reused from |
| --- | --- |
| Mineflayer actions, tasks, stop, observation | agent-mc-world `MinecraftAgentClient` (`call`, `status`, `task`), `parseSteps`, `SKILL_NAMES`, `SKILL_STEP_SCHEMA` |
| Mineflayer events + memory facts | agent-mc-world `EventEnvelope` + `requestFacts` via `eventObservers` |
| Numen contract | agent-mc-world `NumenBodyPort` (`numen-port.ts`: `catalog`, `call`, `result`, `facts`, `battlefield`) |
| Numen hosted transport | numen-hosting `numenCorePort` (`core-port.mjs`), `HostedRoles` start hook (fencing/epoch, opaqueId) |
| mcbot protocol | field names/kinds/tool list from `McbotPaper.java`, `Policy.java`, `Toolbox.java`; agent-mc-world `_client` plugin channels |
| maid transport, validation, reply matching | touhou-maids `createMaidPort`, `MAID_TOOL` (`maid-port.mjs`) |
| anti-cheat detection | agent-mc-world `isMiningWarningText`, `MINING_LIMIT_DEFAULTS` |
| execution receipt shape | agent-mc-world `ExecutionReceipt` |

Re-implemented (no importable module exists): the mcbot varint+JSON frame codec (`encodeMcbotFrame`/`decodeMcbotFrame`, ~30
lines; the reference is a script, `paper/integrations/mcbot/probe`), and the token bucket.

## Tests (`packages/agent-harness/tests/body/`)

* `contract.test.ts` — one suite (8 cases) run against 4 drivers: capabilities well-formed; lifecycle spawn → ready →
  destroy; invalid / unsupported refused without any write reaching the body; action → `action_result` → idempotent
  `result()`; death event + snapshot; anti-cheat warning halt; pace limit; harness drives the body only through the interface.
* Drivers use the real code with fake network edges: Mineflayer = real `MinecraftAgentClient` + agent-mc-world fake world;
  Numen hosted = real `HostedRoles` + `HostingStore` (in-memory sqlite) + fake `hosted_body`; mcbot = fake plugin-channel
  server speaking the Java protocol; maid = fake server for both the `/qdmaid` chat path and plugin-message envelopes.
* `mapping.test.ts` — per-body mapping checks against the real sources (every Mineflayer verb passes `parseSteps`; mcbot
  tools/args match the Java switch; maid commands are accepted by `maidCommand`; native ops = `MAID_TOOL`).
* `gateway-body.test.ts`, `harness-safety.test.ts` — gateway discovery/refusal and the safety pause path.

## Gaps (honest)

* **Numen hosted:** body-neutral verbs are only `chat` (`say`) and `observe`; movement/combat go through `native:lua` /
  `native:skill`. No stop op in `hosted_body` → `stop` unsupported. Perception is sampled (facts poll, default 5 s); a request
  without a final `result` is settled as an inferred completion when `workPending` turns false.
* **mcbot:** `result()` is only the adapter's ledger (the plugin has no result query); `follow` needs a player UUID;
  frame codec duplicated (see above); no push of health — sampled from `status`.
* **Maid:** no free motion (`move`, `look`, `attack`, `mine` …) — TLM maids act through their task AI; `stop` = `stay`;
  `craft` only via the workshop `make` op; health/hunger are not pushed.
* **Mineflayer:** snapshot is parsed from `mc_observe` text (no structured observation API); `wait`, `command`, `recall`,
  `stay`, `sit`, `cast` not mapped; multi-block mine/place use skills (`native:skill:*`).
* **Anti-cheat for maid / hosted bodies:** they do not see server chat; the host must feed the owner connection's system text
  into `feedServerText()`.
* **Not adapters:** `numen-bedrock` (Java form bridge, documented only) and numen-paper's qwenpaw path.
* No live-server test (by design); all four bodies are tested against faithful fakes.
