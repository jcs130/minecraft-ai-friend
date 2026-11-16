/**
 * Unified Body Adapter contract (agent-mc-body/v1).
 *
 * One interface over every Minecraft body the harness can drive:
 *  - mineflayer: agent-mc-world MinecraftAgentClient (an ordinary Java login)
 *  - numen:      a native Numen companion, through numen-hosting `hosted_body` (numenCorePort) or the mcbot plugin channel
 *  - maid:       a Touhou Little Maid NPC, through the qiandengji-maids/v1 bridge (touhou-maids/agent/maid-port.mjs)
 *
 * Bodies differ a lot, so every adapter declares what it supports (`capabilities()`); the harness, planner and gateway read
 * that declaration and degrade gracefully (e.g. hand an intent back to the host) instead of sending unsupported commands.
 */

export const BODY_PROTOCOL = 'agent-mc-body/v1' as const;

export type BodyKind = 'mineflayer' | 'numen' | 'maid';

/** Body-neutral action verbs. Anything body-specific goes through `native`. */
export const ACTION_VERBS = [
  'move', 'follow', 'stop', 'look', 'chat', 'interact', 'use_item', 'attack', 'mine', 'collect', 'place', 'craft', 'smelt',
  'equip', 'eat', 'drop', 'pickup', 'transfer', 'flee', 'wait', 'observe', 'inventory', 'command',
  'recall', 'stay', 'sit', 'cast', 'native',
] as const;
export type ActionVerb = typeof ACTION_VERBS[number];

/** Verbs that move the body or change the world; blocked while a safety halt is active. */
export const MOTION_VERBS: readonly ActionVerb[] = ['move', 'follow', 'look', 'interact', 'use_item', 'attack', 'mine', 'collect', 'place', 'flee', 'recall', 'cast'];

/** Pace categories for rate limiting (see safety.ts). */
export type PaceCategory = 'motion' | 'dig' | 'combat' | 'chat' | 'other';

/** Normalized perception events. */
export const BODY_EVENT_KINDS = [
  'chat', 'whisper', 'system_message', 'player_join', 'player_leave',
  'death', 'respawn', 'health', 'hunger', 'effect', 'level', 'position', 'dimension', 'inventory', 'entity', 'combat',
  'action_progress', 'action_result', 'snapshot', 'status', 'server_status', 'connection', 'lifecycle', 'dialogue', 'safety', 'other',
] as const;
export type BodyEventKind = typeof BODY_EVENT_KINDS[number];

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
