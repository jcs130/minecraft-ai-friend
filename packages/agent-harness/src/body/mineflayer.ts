/**
 * Mineflayer body = agent-mc-world `MinecraftAgentClient` (an ordinary Java login driven by mineflayer).
 *
 * Reuse (no copies): actions go through the client's own tools (`mc_do` skill steps, `mc_stop`, `mc_observe`, `mc_bag` …) with the
 * exclusive-control `bodyKey`; mapped skill steps are pre-validated with agent-mc-world `parseSteps`; native skill schemas come from
 * `SKILL_STEP_SCHEMA`; events are the client's own `EventEnvelope`s (via `eventObservers`) and keep their lazy facts for memory scoping.
 */
import { parseSteps, SKILL_NAMES, SKILL_STEP_SCHEMA } from '../../../agent-mc-world/core/skills.ts';
import { ArgumentError, BaseBodyAdapter, hasXyz, newRequestId, only, optInt, optStr, str, xyz } from './base.ts';
import type { ActionReceipt, ActionSupport, ActionVerb, BodyAction, BodyCapabilities, BodyEventKind, BodyIdentity, BodySnapshot,
  NativeActionInfo } from './types.ts';
import { BODY_PROTOCOL } from './types.ts';

/** Structural subset of agent-mc-world ToolOutcome / ExecutionReceipt. */
export interface MineflayerOutcome { text: string; failed?: boolean | true; retryAfterMs?: number; data?: Record<string, unknown>;
  execution?: { kind: string; id: string; phase: string; terminal: boolean } }
/** Structural subset of agent-mc-world `EventEnvelope`. */
export interface MineflayerEnvelope { type: string; ts: string; text: string; source?: string; cursor?: number; senderKey?: string;
  meta?: Record<string, unknown>; execution?: { kind: string; id: string; phase: string; terminal: boolean } }
/** Structural subset of `MinecraftAgentClient` (agent-mc-world/src/client/runtime.ts). */
export interface MineflayerClientLike {
  call(name: string, args: Record<string, unknown>, options?: { signal?: AbortSignal; bodyKey?: object }): Promise<MineflayerOutcome>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  status(): { phase: string; connection: { ready: boolean; phase: string } | null; facts: unknown | null };
  task?(kind: 'task', id: string): { phase: string; terminal: boolean } | null;
  readonly toolPrefix?: string;
}

export interface MineflayerAdapterOptions {
  /** Minecraft username of the body (to tell own chat from players'). */
  username: string;
  /** Exclusive-control capability from `withAgentHarness` (agent-mc-world `bodyGate.key`). */
  bodyKey?: object;
  /** Realm/server label used when the client has not reported an experience scope yet. */
  serverId?: string;
  now?: () => Date;
}

type Step = Record<string, unknown> & { skill: string };
interface Mapping { tool: string; args: Record<string, unknown>; step?: Step }

const SKILL_CONTRACTS = (SKILL_STEP_SCHEMA as { 'x-agent-mc-skill-contracts'?: Record<string, Array<Record<string, unknown>>> })['x-agent-mc-skill-contracts'] ?? {};
const READ_ONLY_TOOLS = ['observe', 'check', 'bag', 'map', 'scout', 'visual', 'window'];
const NATIVE_TOOLS = ['do', 'goal', 'stop', 'queue', 'observe', 'check', 'bag', 'map', 'scout', 'visual', 'window', 'escape'];

const ACTIONS: Partial<Record<ActionVerb, ActionSupport>> = {
  move: { native: 'mc_do:goto | goto_player', async: true, args: ['x', 'y', 'z', 'at', 'player', 'walkOnly', 'dimension'] },
  follow: { native: 'mc_do:follow', async: true, args: ['player'] },
  stop: { native: 'mc_stop', async: false, args: [] },
  look: { native: 'mc_do:look', async: true, args: ['x', 'y', 'z', 'at'] },
  chat: { native: 'mc_do:chat', async: true, args: ['text'] },
  interact: { native: 'mc_do:use (block/entity)', async: true, args: ['x', 'y', 'z', 'at', 'entityId', 'target', 'item'] },
  use_item: { native: 'mc_do:use (item)', async: true, args: ['item', 'times'] },
  attack: { native: 'mc_do:attack', async: true, args: ['target', 'entityId', 'weapon', 'mode'] },
  mine: { native: 'mc_do:excavate (single block)', async: true, args: ['x', 'y', 'z', 'at', 'tool'], notes: 'paced by agent-mc-world mining limiter' },
  collect: { native: 'mc_do:collect', async: true, args: ['block', 'count', 'tool'] },
  place: { native: 'mc_do:build (single block)', async: true, args: ['item', 'x', 'y', 'z', 'at'] },
  craft: { native: 'mc_do:craft', async: true, args: ['item', 'count'] },
  smelt: { native: 'mc_do:smelt', async: true, args: ['input', 'fuel', 'count', 'x', 'y', 'z', 'at'] },
  equip: { native: 'mc_do:equip', async: true, args: ['item', 'hand'] },
  eat: { native: 'mc_do:eat', async: true, args: ['item'] },
  drop: { native: 'mc_do:toss', async: true, args: ['item', 'count'] },
  pickup: { native: 'mc_do:pickup', async: true, args: ['item'] },
  transfer: { native: 'mc_do:take | stow', async: true, args: ['direction', 'item', 'count', 'x', 'y', 'z', 'at'] },
  flee: { native: 'mc_do:flee', async: true, args: ['distance'] },
  observe: { native: 'mc_observe', async: false, args: [] },
  inventory: { native: 'mc_bag', async: false, args: [] },
};

const EVENTS: BodyEventKind[] = ['chat', 'whisper', 'system_message', 'player_join', 'player_leave', 'death', 'respawn', 'health', 'hunger',
  'effect', 'level', 'dimension', 'entity', 'combat', 'action_progress', 'action_result', 'snapshot', 'status', 'server_status', 'connection',
  'lifecycle', 'safety', 'other'];

export class MineflayerBodyAdapter extends BaseBodyAdapter {
  readonly kind = 'mineflayer' as const;
  private client: MineflayerClientLike | null = null;
  private lastFacts: (() => unknown) | null = null;
  /** Pass to `MinecraftClientOptions.eventObservers` (the client calls it for every event; never throws). */
  readonly observer = (event: MineflayerEnvelope, facts: unknown) => {
    try { this.onEnvelope(event, typeof facts === 'function' ? facts as () => unknown : () => facts); } catch (error) { this.fail(error); }
  };

  constructor(private readonly options: MineflayerAdapterOptions) { super(options.now); }

  /** Bind the constructed client (the client takes `observer` at construction, so binding happens after). */
  attach(client: MineflayerClientLike): this { this.client = client; return this; }
  private get prefix() { return this.client?.toolPrefix ?? 'mc'; }

  identity(): BodyIdentity | null {
    const facts = (this.lastFacts?.() ?? this.client?.status().facts ?? null) as {
      world?: { key?: string | null; dimensionType?: string | null; revision?: number } | null;
      experience?: { scope?: { realm: string; account: string; agent: string } | null } | null } | null;
    const scope = facts?.experience?.scope ?? { realm: this.options.serverId ?? 'unknown', account: `offline:${this.options.username}`, agent: this.options.username.toLowerCase() };
    return { kind: 'mineflayer', bodyId: scope.account, name: this.options.username, ownerId: null,
      world: { serverId: scope.realm, worldKey: facts?.world?.key ?? null, dimension: facts?.world?.dimensionType ?? null },
      scope, generation: facts?.world?.revision !== undefined ? String(facts.world.revision) : null };
  }

  capabilities(): BodyCapabilities {
    const p = this.prefix;
    const skills: NativeActionInfo[] = SKILL_NAMES.map(name => ({ name: `skill:${name}`, readOnly: false,
      description: `agent-mc-world mc_do skill step "${name}" (args = the step without "skill")`,
      ...(SKILL_CONTRACTS[name] ? { schema: { oneOf: SKILL_CONTRACTS[name] } } : {}) }));
    const tools: NativeActionInfo[] = NATIVE_TOOLS.map(t => ({ name: `tool:${p}_${t}`, readOnly: READ_ONLY_TOOLS.includes(t),
      description: `agent-mc-world ${p}_${t} tool (raw arguments)` }));
    return { protocol: BODY_PROTOCOL, kind: 'mineflayer', transport: 'agent-mc-world', actions: ACTIONS, nativeActions: [...skills, ...tools],
      events: EVENTS, snapshot: ['position', 'dimension', 'health', 'food', 'inventory', 'entities', 'lifeState', 'text'],
      lifecycle: { spawn: 'connect', reconnect: true, destroy: 'disconnect' }, perception: 'push',
      safety: { antiCheatStop: true, paceLimits: true, nativeGuards: ['mining-limiter (agent-mc-world core/mining-limiter.ts)', 'movement-pace (core/movement-pace.ts)', 'combat rules'] },
      limits: ['Snapshot fields are parsed from the client fact parts (narrative text); `text` carries the original.', 'wait/command/recall/stay/sit/cast have no mineflayer mapping (use native skill:* steps).'] };
  }

  /** Lifecycle follows the real client phase (the client may be connected before/without `spawn`). */
  lifecycle() {
    if (this.state === 'destroyed' || !this.client) return this.state;
    if (this.client.status().phase === 'started') return this.state === 'dead' || this.state === 'reconnecting' ? this.state : 'ready';
    return this.state === 'spawning' || this.state === 'error' ? this.state : 'detached';
  }
  protected connected(): boolean { return !!this.client && this.state !== 'destroyed' && this.client.status().phase === 'started'; }

  protected async doSpawn(): Promise<void> {
    if (!this.client) throw new Error('no MinecraftAgentClient attached');
    if (this.client.status().phase !== 'started') await this.client.connect();
  }
  protected async doDestroy(): Promise<void> { if (this.client && this.client.status().phase === 'started') await this.client.disconnect(); }

  private call(tool: string, args: Record<string, unknown>, signal?: AbortSignal) {
    return this.client!.call(tool, args, { ...(signal ? { signal } : {}), ...(this.options.bodyKey ? { bodyKey: this.options.bodyKey } : {}) });
  }

  protected async doAct(action: BodyAction & { verb: ActionVerb; requestId: string }, signal?: AbortSignal): Promise<ActionReceipt> {
    const m = this.map(action);
    if (m.step) {
      const parsed = parseSteps([m.step]);
      if ('error' in parsed) return this.receipt(action.requestId, action.verb, 'rejected', `skill step rejected by agent-mc-world: ${parsed.error}`);
    }
    if (action.verb === 'stop') return this.doStop('stop action', action.requestId);
    return this.fromOutcome(action.requestId, action.verb, await this.call(m.tool, m.args, signal));
  }

  private fromOutcome(requestId: string, verb: ActionVerb, out: MineflayerOutcome): ActionReceipt {
    const e = out.execution;
    if (out.failed) return this.receipt(requestId, verb, 'failed', out.text, { ...(e ? { executionId: e.id } : {}), ...(out.retryAfterMs ? { retryAfterMs: out.retryAfterMs } : {}), ...(out.data ? { data: out.data } : {}) });
    if (e && !e.terminal) return this.receipt(requestId, verb, 'accepted', out.text, { executionId: e.id, ...(out.data ? { data: out.data } : {}) });
    const ok = !e || e.phase === 'completed';
    return this.receipt(requestId, verb, ok ? 'completed' : e!.phase === 'cancelled' ? 'failed' : 'failed', out.text, { ...(e ? { executionId: e.id } : {}), ...(out.data ? { data: out.data } : {}) });
  }

  /** Unified verb → agent-mc-world tool call. Argument errors throw ArgumentError (nothing sent). */
  private map(a: BodyAction & { verb: ActionVerb }): Mapping {
    const args = a.args ?? {};
    const p = this.prefix;
    const step = (s: Step): Mapping => ({ tool: `${p}_do`, args: { steps: [s] }, step: s });
    const at = () => { const v = xyz(args); return [v.x, v.y, v.z]; };
    switch (a.verb) {
      case 'move':
        only(args, ACTIONS.move!.args, 'move');
        if (args.player !== undefined) return step({ skill: 'goto_player', name: str(args.player, 'player', 16) });
        return step({ skill: 'goto', at: at(), ...(args.walkOnly !== undefined ? { walkOnly: !!args.walkOnly } : {}), ...(args.dimension ? { dimension: str(args.dimension, 'dimension') } : {}) });
      case 'follow': only(args, ['player'], 'follow'); return step({ skill: 'follow', name: str(args.player, 'player', 16) });
      case 'look': only(args, ['x', 'y', 'z', 'at'], 'look'); return step({ skill: 'look', at: at() });
      case 'chat': only(args, ['text'], 'chat'); return step({ skill: 'chat', text: str(args.text, 'text', 256) });
      case 'interact': {
        only(args, ACTIONS.interact!.args, 'interact');
        const target = hasXyz(args) ? { at: at() } : args.entityId !== undefined ? { entityId: optInt(args.entityId, 'entityId', 0, 2 ** 31 - 1) }
          : args.target !== undefined ? { target: str(args.target, 'target') } : null;
        if (!target) throw new ArgumentError('interact needs x,y,z / at, entityId or target');
        return step({ skill: 'use', ...target, ...(args.item ? { item: str(args.item, 'item') } : {}) });
      }
      case 'use_item': only(args, ['item', 'times'], 'use_item');
        return step({ skill: 'use', ...(args.item ? { item: str(args.item, 'item') } : {}), ...(args.times !== undefined ? { times: optInt(args.times, 'times', 1, 64) } : {}) });
      case 'attack': only(args, ACTIONS.attack!.args, 'attack');
        return step({ skill: 'attack', ...(args.target ? { target: str(args.target, 'target') } : {}), ...(args.entityId !== undefined ? { entityId: optInt(args.entityId, 'entityId', 0, 2 ** 31 - 1) } : {}),
          ...(args.weapon ? { weapon: str(args.weapon, 'weapon') } : {}), ...(args.mode ? { mode: str(args.mode, 'mode') } : {}) });
      case 'mine': { only(args, ACTIONS.mine!.args, 'mine'); const pos = at();
        return step({ skill: 'excavate', shape: 'line', anchors: [pos, pos], ...(args.tool ? { tool: str(args.tool, 'tool') } : {}) }); }
      case 'collect': only(args, ACTIONS.collect!.args, 'collect');
        return step({ skill: 'collect', block: str(args.block, 'block'), ...(args.count !== undefined ? { count: optInt(args.count, 'count', 1, 2304) } : {}), ...(args.tool ? { tool: str(args.tool, 'tool') } : {}) });
      case 'place': only(args, ACTIONS.place!.args, 'place'); return step({ skill: 'build', material: str(args.item, 'item'), at: at() });
      case 'craft': only(args, ['item', 'count'], 'craft'); return step({ skill: 'craft', item: str(args.item, 'item'), ...(args.count !== undefined ? { count: optInt(args.count, 'count', 1, 2304) } : {}) });
      case 'smelt': only(args, ACTIONS.smelt!.args, 'smelt');
        return step({ skill: 'smelt', input: str(args.input, 'input'), fuel: str(args.fuel, 'fuel'), ...(args.count !== undefined ? { count: optInt(args.count, 'count', 1, 2304) } : {}), ...(hasXyz(args) ? { at: at() } : {}) });
      case 'equip': only(args, ['item', 'hand'], 'equip'); return step({ skill: 'equip', item: str(args.item, 'item'), ...(args.hand ? { hand: str(args.hand, 'hand') } : {}) });
      case 'eat': only(args, ['item'], 'eat'); return step({ skill: 'eat', item: str(args.item, 'item') });
      case 'drop': only(args, ['item', 'count'], 'drop'); return step({ skill: 'toss', item: str(args.item, 'item'), ...(args.count !== undefined ? { count: optInt(args.count, 'count', 1, 2304) } : {}) });
      case 'pickup': only(args, ['item'], 'pickup'); return step({ skill: 'pickup', ...(args.item ? { item: str(args.item, 'item') } : {}) });
      case 'transfer': {
        only(args, ACTIONS.transfer!.args, 'transfer');
        const dir = args.direction; if (dir !== 'take' && dir !== 'put') throw new ArgumentError('transfer.direction must be take or put');
        const base = { item: str(args.item, 'item'), count: optInt(args.count, 'count', 1, 2304) ?? 1, ...(hasXyz(args) ? { at: at() } : {}) };
        return step({ skill: dir === 'take' ? 'take' : 'stow', ...base });
      }
      case 'flee': only(args, ['distance'], 'flee'); return step({ skill: 'flee', ...(args.distance !== undefined ? { distance: optInt(args.distance, 'distance', 1, 256) } : {}) });
      case 'observe': only(args, [], 'observe'); return { tool: `${p}_observe`, args: {} };
      case 'inventory': only(args, [], 'inventory'); return { tool: `${p}_bag`, args: {} };
      case 'stop': return { tool: `${p}_stop`, args: {} };
      case 'native': {
        const name = a.name!;
        if (name.startsWith('skill:')) return step({ ...args, skill: name.slice(6) });
        return { tool: name.slice(5), args };
      }
      default: throw new ArgumentError(`unsupported verb ${a.verb}`);
    }
  }

  protected async doResult(requestId: string): Promise<ActionReceipt | null> {
    const known = this.receipts.get(requestId);
    if (!known?.executionId || !this.client?.task) return null;
    const t = this.client.task('task', known.executionId);
    if (!t?.terminal) return null;
    return this.receipt(requestId, known.verb, t.phase === 'completed' ? 'completed' : 'failed', `task ${known.executionId} ${t.phase}`, { executionId: known.executionId });
  }

  protected async doStop(reason: string, requestId = newRequestId('stop')): Promise<ActionReceipt> {
    const out = await this.call(`${this.prefix}_stop`, {}, AbortSignal.timeout(10_000));
    return this.fromOutcome(requestId, 'stop', out.failed ? out : { ...out, execution: undefined, text: out.text || reason });
  }

  async snapshot(): Promise<BodySnapshot> {
    const st = this.client?.status();
    const facts = (st?.facts ?? null) as { parts?: Array<{ key: string; text: string }>; text?: string; world?: { key?: string | null; dimensionType?: string | null } } | null;
    const part = (k: string) => facts?.parts?.find(x => x.key === k)?.text ?? null;
    const place = part('place'), body = part('body'), life = part('deathLifecycle');
    const pos = place ? /格 \((-?\d+), (-?\d+), (-?\d+)\)/.exec(place) : null;
    const hp = body ? /生命 (\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?/.exec(body) : null;
    const food = body ? /饥饿 (\d+)\/20/.exec(body) : null;
    let lifeState: BodySnapshot['lifeState'] = facts ? 'alive' : 'unknown';
    try { const l = life ? JSON.parse(life) as { phase?: string } : null; if (l?.phase && l.phase !== 'alive') lifeState = 'dead'; } catch { /* keep */ }
    return { sampledAt: this.now().toISOString(), lifeState,
      position: pos ? { x: Number(pos[1]), y: Number(pos[2]), z: Number(pos[3]) } : null,
      dimension: facts?.world?.dimensionType ?? null, health: hp ? Number(hp[1]) : null, maxHealth: hp?.[2] ? Number(hp[2]) : null,
      food: food ? Number(food[1]) : null, inventory: part('inventoryIds'), entities: part('players'),
      text: facts?.parts?.map(x => x.text).join('\n') ?? facts?.text ?? null, raw: facts };
  }

  // ---- perception ----
  private onEnvelope(env: MineflayerEnvelope, facts: () => unknown): void {
    this.lastFacts = facts;
    const { kind, data, severity } = classifyMineflayerEvent(env, this.options.username);
    if (kind === 'connection' && data.connected === false && this.state === 'ready') this.state = 'reconnecting';
    if (kind === 'death') this.state = this.state === 'ready' ? 'dead' : this.state;
    if (kind === 'respawn' && this.state === 'dead') this.state = 'ready';
    const exec = env.execution;
    if (exec?.terminal) {
      for (const r of this.receipts.values()) if (r.executionId === exec.id && !r.terminal) {
        const status = exec.phase === 'completed' ? 'completed' : 'failed';
        this.receipts.set(r.requestId, this.receipt(r.requestId, r.verb, status, env.text, { executionId: exec.id }));
        if (status === 'completed') this.counters.completed++; else this.counters.failed++;
      }
    }
    this.emit({ kind, at: env.ts, text: env.text, data, ...(severity ? { severity } : {}), ...(exec ? { execution: exec } : {}), raw: env, facts });
  }
}

/** Map an agent-mc-world EventEnvelope to a unified event kind (prefix-agnostic: minecraft.* / mymc.*). */
export function classifyMineflayerEvent(env: MineflayerEnvelope, self: string): { kind: BodyEventKind; data: Record<string, unknown>; severity?: 1 | 2 | 3 } {
  const sub = env.type.slice(env.type.indexOf('.') + 1);
  const meta = env.meta ?? {};
  const uname = typeof meta.uname === 'string' ? meta.uname : null;
  const base: Record<string, unknown> = { bodyType: env.type, ...(env.cursor !== undefined ? { cursor: env.cursor } : {}) };
  if (env.execution) {
    return { kind: env.execution.terminal ? 'action_result' : 'action_progress', data: { ...base, executionId: env.execution.id, phase: env.execution.phase } };
  }
  switch (sub) {
    case 'chat': {
      if (meta.channel === 'system' || meta.channel === 'actionbar' || !uname) return { kind: 'system_message', data: { ...base, channel: meta.channel ?? 'system' } };
      const whisper = /^\[MC 私聊\]/.test(env.text);
      return { kind: whisper ? 'whisper' : 'chat', data: { ...base, player: uname, self: uname === self, whisper, voice: /附近语音/.test(env.text) },
        ...(whisper && uname !== self ? {} : { severity: 1 as const }) };
    }
    case 'chat.sent': return { kind: 'chat', data: { ...base, player: self, self: true }, severity: 1 };
    case 'client.message': return { kind: 'system_message', data: { ...base, channel: 'system' } };
    case 'enter': return { kind: 'player_join', data: { ...base, player: uname } };
    case 'leave': return { kind: 'player_leave', data: { ...base, player: uname } };
    case 'client.disconnected': return { kind: 'connection', data: { ...base, connected: false } };
    case 'lifecycle': return { kind: 'lifecycle', data: base };
    case 'combat': case 'reflex': return { kind: 'combat', data: base };
    case 'world': case 'world.snapshot': return { kind: 'snapshot', data: base };
    case 'sleep': case 'wake': case 'body': return { kind: 'status', data: { ...base, status: sub } };
    case 'event': {
      if (meta.death && typeof meta.death === 'object') {
        const d = meta.death as { position?: unknown; cause?: { text?: string } | null };
        return { kind: 'death', data: { ...base, position: d.position ?? null, cause: d.cause?.text ?? null } };
      }
      const life = meta.deathLifecycle as { phase?: string } | undefined;
      if (life?.phase === 'alive') return { kind: 'respawn', data: base };
      if (meta.worldTransition) return { kind: 'dimension', data: { ...base, transition: meta.worldTransition } };
      if (meta.entityLifecycle) return { kind: 'entity', data: { ...base, entity: meta.entityLifecycle } };
      if (meta.nutritionNeed) return { kind: 'hunger', data: base };
      const level = /升到\s*(\d{1,5})\s*级/.exec(env.text);
      if (level) return { kind: 'level', data: { ...base, level: Number(level[1]) } };
      if (/濒死/.test(env.text)) return { kind: 'health', data: { ...base, critical: true }, severity: 3 };
      if (/生命 |身体状态已同步/.test(env.text)) return { kind: 'health', data: base };
      if (/中了「/.test(env.text)) return { kind: 'effect', data: base };
      if (/附近有|出现了|驯服了/.test(env.text)) return { kind: 'entity', data: base };
      if (/服务器(停了|就绪|启动中|出问题)/.test(env.text)) return { kind: 'server_status', data: base };
      return { kind: 'status', data: base };
    }
    default: return { kind: 'other', data: base };
  }
}
