/**
 * Numen body: a native Numen companion (server-side player) driven through agent-mc-world's `NumenBodyPort` contract.
 *
 * Two existing transports implement that port and are reused as-is:
 *  - numen-hosting `numenCorePort(hosting, role, epoch)` → `hosted_body` MCP (qiandengji-hosted-body/v1). Native vocabulary:
 *    lua / say / skill / todo / memory / guide (the Numen catalog). Only `chat` (say) and `observe` are body-neutral; movement,
 *    combat … are Lua programs written against the Numen API (`guide`/`skill`), i.e. planner work, so they are `native` only.
 *  - mcbot plugin channel (`McbotNumenPort`, mcbot-port.ts) → QiandengjiMcbot Paper plugin: fixed tool set (move_to, follow,
 *    attack, break_block, place_block, collect, craft, smelt, transfer, equip, consume, use_item, use_block, wait, command, status …).
 *
 * Capabilities are discovered from the port's own `catalog()` at spawn, so a body only advertises what its server really exposes.
 */
import type { NumenBodyFacts, NumenBodyPort } from '../../../agent-mc-world/src/client/numen-client.ts';
import { ArgumentError, BaseBodyAdapter, hasXyz, newRequestId, only, optInt, str, xyz } from './base.ts';
import type { ActionReceipt, ActionSupport, ActionVerb, BodyAction, BodyCapabilities, BodyEventKind, BodyIdentity, BodySnapshot, NativeActionInfo } from './types.ts';
import { BODY_PROTOCOL } from './types.ts';

export type { NumenBodyPort, NumenBodyFacts };
type ToolOutcomeLike = Awaited<ReturnType<NumenBodyPort['call']>>;

/** Event pushed by a transport (mcbot companion_state / job_event …). */
export interface NumenPortEvent { kind: BodyEventKind; text: string; data: Record<string, unknown>; requestId?: string; state?: string; raw?: unknown }

/** Optional extensions a transport may add on top of NumenBodyPort (mcbot pushes state and supports cancel). */
export interface NumenPortExtensions {
  transport?: string;
  /** Push events from the transport (companion_state, job_event …). Returns unsubscribe. */
  onEvent?(listener: (e: NumenPortEvent) => void): () => void;
  /** Stop the body's current native work (mcbot `cancel`). */
  cancel?(reason: string): Promise<{ ok: boolean; text: string }>;
  /** Current control generation (hosted epoch / mcbot body_id). */
  generation?(): string | null;
  /** Release on destroy (mcbot dismiss = native sleep; never deletes the companion). */
  release?(): Promise<void>;
}

export interface NumenAdapterOptions {
  port: NumenBodyPort & NumenPortExtensions;
  /** Owner of the companion (Numen owner UUID / hosting ownerId). */
  ownerId?: string | null;
  /** Transport label; defaults to port.transport or `numen-hosted`. */
  transport?: string;
  /** Hosted control epoch (numenCorePort is bound to one epoch). */
  epoch?: number | string | null;
  /** Fact sampling period for perception (ms). 0 disables polling. Default 5000. */
  pollMs?: number;
  /** Period for reconciling accepted requests with `port.result` (ms). Default 1500. */
  resultPollMs?: number;
  now?: () => Date;
}

type Mapper = (args: Record<string, unknown>) => Record<string, unknown>;
interface VerbMap { tool: string; map: Mapper; support: Omit<ActionSupport, 'native'> }

const pos = (a: Record<string, unknown>) => xyz(a);
/** Body-neutral verb → native tool, keyed by native tool name (only active when the port's catalog lists the tool). */
const VERB_MAPS: Partial<Record<ActionVerb, VerbMap[]>> = {
  chat: [{ tool: 'say', map: a => { only(a, ['text'], 'chat'); return { text: str(a.text, 'text', 256) }; }, support: { async: true, args: ['text'] } }],
  move: [{ tool: 'move_to', map: a => { only(a, ['x', 'y', 'z', 'at', 'walkOnly'], 'move'); return { ...pos(a), ...(a.walkOnly !== undefined ? { walk_only: !!a.walkOnly } : {}) }; },
    support: { async: true, args: ['x', 'y', 'z', 'at', 'walkOnly'], notes: 'mcbot move_to (≤64 blocks)' } }],
  follow: [{ tool: 'follow', map: a => { only(a, ['targetUuid', 'distance', 'seconds', 'protectOwner'], 'follow');
    return { target_uuid: str(a.targetUuid, 'targetUuid', 36), ...(a.distance !== undefined ? { distance: a.distance } : {}), ...(a.seconds !== undefined ? { seconds: a.seconds } : {}),
      ...(a.protectOwner !== undefined ? { protect_owner: !!a.protectOwner } : {}) }; }, support: { async: true, args: ['targetUuid', 'distance', 'seconds', 'protectOwner'], notes: 'needs an entity UUID (scan_area), not a name' } }],
  interact: [{ tool: 'use_block', map: a => { only(a, ['x', 'y', 'z', 'at'], 'interact'); return pos(a); }, support: { async: true, args: ['x', 'y', 'z', 'at'] } }],
  use_item: [{ tool: 'use_item', map: a => { only(a, ['seconds'], 'use_item'); return a.seconds !== undefined ? { seconds: a.seconds } : {}; }, support: { async: true, args: ['seconds'] } }],
  attack: [{ tool: 'attack', map: a => { only(a, ['entityId', 'targetUuid', 'maxHits'], 'attack');
    if (a.entityId === undefined && a.targetUuid === undefined) throw new ArgumentError('attack needs entityId or targetUuid');
    return { ...(a.entityId !== undefined ? { entity_id: a.entityId } : {}), ...(a.targetUuid !== undefined ? { target_uuid: str(a.targetUuid, 'targetUuid', 36) } : {}),
      ...(a.maxHits !== undefined ? { max_hits: optInt(a.maxHits, 'maxHits', 1, 10) } : {}) }; }, support: { async: true, args: ['entityId', 'targetUuid', 'maxHits'], notes: 'hostile, unnamed, visible mobs only (mcbot policy)' } }],
  mine: [{ tool: 'break_block', map: a => { only(a, ['x', 'y', 'z', 'at'], 'mine'); return pos(a); }, support: { async: true, args: ['x', 'y', 'z', 'at'] } }],
  collect: [{ tool: 'collect', map: a => { only(a, ['x', 'y', 'z', 'at', 'radius'], 'collect'); return { ...(hasXyz(a) ? pos(a) : {}), ...(a.radius !== undefined ? { r: optInt(a.radius, 'radius', 1, 12) } : {}) }; },
    support: { async: true, args: ['x', 'y', 'z', 'at', 'radius'], notes: 'picks up dropped items around a point' } }],
  pickup: [{ tool: 'collect', map: a => { only(a, ['x', 'y', 'z', 'at', 'radius'], 'pickup'); return { ...(hasXyz(a) ? pos(a) : {}), ...(a.radius !== undefined ? { r: optInt(a.radius, 'radius', 1, 12) } : {}) }; },
    support: { async: true, args: ['x', 'y', 'z', 'at', 'radius'] } }],
  place: [{ tool: 'place_block', map: a => { only(a, ['x', 'y', 'z', 'at', 'item'], 'place'); return { ...pos(a), item: str(a.item, 'item') }; }, support: { async: true, args: ['x', 'y', 'z', 'at', 'item'] } }],
  craft: [{ tool: 'craft', map: a => { only(a, ['item', 'count', 'query'], 'craft'); return { item: str(a.item, 'item'), ...(a.count !== undefined ? { count: optInt(a.count, 'count', 1, 64) } : {}), ...(a.query !== undefined ? { query: !!a.query } : {}) }; },
    support: { async: true, args: ['item', 'count', 'query'] } }],
  smelt: [{ tool: 'smelt', map: a => { only(a, ['x', 'y', 'z', 'at', 'action', 'inputSlot', 'inputCount', 'fuelSlot', 'fuelCount', 'slot', 'count'], 'smelt');
    const r: Record<string, unknown> = { ...pos(a) };
    for (const [k, v] of [['action', 'action'], ['inputSlot', 'input_slot'], ['inputCount', 'input_count'], ['fuelSlot', 'fuel_slot'], ['fuelCount', 'fuel_count'], ['slot', 'slot'], ['count', 'count']] as const)
      if (a[k] !== undefined) r[v] = a[k];
    return r; }, support: { async: true, args: ['x', 'y', 'z', 'at', 'action', 'inputSlot', 'inputCount', 'fuelSlot', 'fuelCount', 'slot', 'count'], notes: 'furnace query/load/take by slot' } }],
  equip: [{ tool: 'equip', map: a => { only(a, ['slot', 'hand'], 'equip'); return { slot: optInt(a.slot, 'slot', 0, 35) ?? (() => { throw new ArgumentError('equip needs slot'); })(), ...(a.hand ? { target: a.hand } : {}) }; },
    support: { async: true, args: ['slot', 'hand'], notes: 'inventory slot number, not item name' } }],
  eat: [{ tool: 'consume', map: a => { only(a, ['slot'], 'eat'); return a.slot !== undefined ? { slot: optInt(a.slot, 'slot', 0, 35) } : {}; }, support: { async: true, args: ['slot'] } }],
  transfer: [{ tool: 'transfer', map: a => { only(a, ['x', 'y', 'z', 'at', 'direction', 'item'], 'transfer');
    if (a.direction !== 'take' && a.direction !== 'put') throw new ArgumentError('transfer.direction must be take or put');
    return { ...pos(a), dir: a.direction === 'take' ? 'out' : 'in', ...(a.item ? { item: str(a.item, 'item') } : {}) }; }, support: { async: true, args: ['x', 'y', 'z', 'at', 'direction', 'item'] } }],
  wait: [{ tool: 'wait', map: a => { only(a, ['seconds', 'ticks'], 'wait'); return { ...(a.seconds !== undefined ? { seconds: a.seconds } : {}), ...(a.ticks !== undefined ? { ticks: a.ticks } : {}) }; }, support: { async: true, args: ['seconds', 'ticks'] } }],
  command: [{ tool: 'command', map: a => { only(a, ['command'], 'command'); return { command: str(a.command, 'command', 240) }; }, support: { async: true, args: ['command'], notes: 'only the /mycli gameplay whitelist (mcbot Policy.command)' } }],
  inventory: [{ tool: 'inventory', map: a => { only(a, [], 'inventory'); return {}; }, support: { async: false, args: [] } }],
};
const READ_ONLY = new Set(['status', 'inventory', 'scan_area', 'find_resource', 'inspect_block', 'guide', 'catalog']);

export class NumenBodyAdapter extends BaseBodyAdapter {
  readonly kind = 'numen' as const;
  private readonly port: NumenBodyPort & NumenPortExtensions;
  private catalog: Array<{ name: string; description: string; parameters: Record<string, unknown> }> = [];
  private lastFacts: NumenBodyFacts | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private resultTimer: ReturnType<typeof setInterval> | null = null;
  private offPort: (() => void) | null = null;
  private dispatchedWhileBusy = new Set<string>();
  private polling = false;

  constructor(private readonly options: NumenAdapterOptions) { super(options.now); this.port = options.port; }

  private get transport() { return this.options.transport ?? this.port.transport ?? 'numen-hosted'; }

  identity(): BodyIdentity {
    const id = this.port.identity;
    return { kind: 'numen', bodyId: id.uuid, name: id.name, ownerId: this.options.ownerId ?? null,
      world: { serverId: id.server, worldKey: null, dimension: this.lastFacts?.dimension ?? null },
      scope: { realm: id.server, account: `numen:${id.uuid}`, agent: id.name.toLowerCase() },
      generation: this.port.generation?.() ?? (this.options.epoch !== undefined && this.options.epoch !== null ? String(this.options.epoch) : null) };
  }

  capabilities(): BodyCapabilities {
    const names = new Set(this.catalog.map(t => t.name));
    const actions: BodyCapabilities['actions'] = {};
    for (const [verb, maps] of Object.entries(VERB_MAPS) as Array<[ActionVerb, VerbMap[]]>) {
      const m = maps.find(x => names.has(x.tool));
      if (m) actions[verb] = { native: m.tool, ...m.support };
    }
    actions.observe = { native: names.has('status') ? 'status' : 'hosted_body observe', async: false, args: [] };
    if (this.port.cancel) actions.stop = { native: 'cancel', async: false, args: [] };
    const nativeActions: NativeActionInfo[] = this.catalog.map(t => ({ name: t.name, description: t.description, readOnly: READ_ONLY.has(t.name), schema: t.parameters }));
    const events: BodyEventKind[] = ['action_result', 'lifecycle', 'safety'];
    if (this.port.facts) events.push('health', 'hunger', 'position', 'dimension', 'death', 'respawn', 'status');
    if (this.port.battlefield) events.push('entity');
    if (this.port.onEvent) events.push('connection', 'system_message');
    return { protocol: BODY_PROTOCOL, kind: 'numen', transport: this.transport, actions, nativeActions, events,
      snapshot: ['text', ...(this.port.facts ? ['position', 'dimension', 'health', 'food', 'lifeState'] as const : []), ...(this.port.battlefield ? ['entities'] as const : [])],
      lifecycle: { spawn: this.transport === 'mcbot' ? 'summon' : 'attach', reconnect: true, destroy: this.port.release ? 'dismiss' : 'detach' },
      perception: this.port.onEvent ? 'push+poll' : 'poll',
      safety: { antiCheatStop: true, paceLimits: true, nativeGuards: ['Numen permission rules / claims', ...(this.transport === 'mcbot' ? ['mcbot Policy (tool whitelist, /mycli only, hostile-only attack)'] : ['hosted_body fence + epoch (CONTROL_CHANGED)'])] },
      limits: [
        ...(this.transport === 'numen-hosted' ? ['Body-neutral movement/combat need Lua programs (native lua) written from the Numen guide; no fixed verb mapping.', 'No stop op through hosted_body: stopping is a hosting mode switch (paused) by the coordinator.'] : []),
        'Perception is sampled (facts every pollMs), not a native event stream; get_events stays with the native brain/inbox.',
        'Accepted (partial) requests settle via port.result or when facts report no pending native work (inferred).',
      ] };
  }

  protected connected(): boolean { return this.state === 'ready' || this.state === 'dead'; }

  protected async doSpawn(signal?: AbortSignal): Promise<void> {
    const state = await this.port.connect();
    signal?.throwIfAborted();
    const id = this.port.identity;
    if (!state.ready || state.uuid !== id.uuid || state.server !== id.server) {
      await this.port.disconnect();
      throw new Error('Numen body is not ready or its identity differs from the selected role');
    }
    this.catalog = await this.port.catalog(signal);
    this.offPort?.();
    this.offPort = this.port.onEvent?.(e => this.onPortEvent(e)) ?? null;
    this.startPolling();
  }

  protected async doDestroy(): Promise<void> {
    this.stopPolling(); this.offPort?.(); this.offPort = null;
    if (this.port.release) await this.port.release();
    await this.port.disconnect();
  }

  private startPolling(): void {
    this.stopPolling();
    const ms = this.options.pollMs ?? 5000;
    if (ms > 0 && this.port.facts) { this.pollTimer = setInterval(() => void this.poll(), ms); this.pollTimer.unref?.(); }
    const rms = this.options.resultPollMs ?? 1500;
    if (rms > 0) { this.resultTimer = setInterval(() => void this.reconcileAccepted(), rms); this.resultTimer.unref?.(); }
  }
  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer); if (this.resultTimer) clearInterval(this.resultTimer);
    this.pollTimer = this.resultTimer = null;
  }

  /** One perception sample (also callable directly, e.g. by tests or a host tick). */
  async poll(signal?: AbortSignal): Promise<void> {
    if (this.polling || !this.port.facts || !this.connected()) return;
    this.polling = true;
    try {
      const f = await this.port.facts(signal);
      if (!f) return;
      const id = this.port.identity;
      if (f.uuid !== id.uuid || f.server !== id.server) { this.setState('error', 'Numen facts identity mismatch; stopped using this body'); this.stopPolling(); return; }
      this.diffFacts(this.lastFacts, f);
      this.lastFacts = f;
      if (!f.workPending) this.settleIdle();
    } catch (error) { this.fail(error); } finally { this.polling = false; }
  }

  private diffFacts(prev: NumenBodyFacts | null, f: NumenBodyFacts): void {
    const at = new Date(f.sampledAt).toISOString();
    if (!prev) { this.emit({ kind: 'status', at, text: `Numen body ${f.dimension} [${f.position.join(',')}] health ${f.health}/${f.maxHealth} food ${f.food}`, data: { ...f } }); return; }
    if (prev.health > 0 && f.health <= 0) { if (this.state === 'ready') this.state = 'dead'; this.emit({ kind: 'death', at, text: `Numen 身体死亡 @ ${f.position.join(',')}`, data: { position: f.position, dimension: f.dimension } }); }
    else if (prev.health <= 0 && f.health > 0) { if (this.state === 'dead') this.state = 'ready'; this.emit({ kind: 'respawn', at, text: 'Numen 身体已重生', data: { position: f.position } }); }
    else if (f.health !== prev.health) this.emit({ kind: 'health', at, text: `生命 ${f.health}/${f.maxHealth}`, severity: f.health <= f.maxHealth * 0.25 ? 3 : 1, data: { health: f.health, maxHealth: f.maxHealth, previous: prev.health } });
    if (f.food !== prev.food) this.emit({ kind: 'hunger', at, text: `饥饿 ${f.food}/20`, data: { food: f.food, previous: prev.food } });
    if (f.dimension !== prev.dimension) this.emit({ kind: 'dimension', at, text: `维度 ${prev.dimension} → ${f.dimension}`, data: { from: prev.dimension, to: f.dimension } });
    else if (f.position.some((v, i) => Math.abs(v - prev.position[i]!) >= 4)) this.emit({ kind: 'position', at, text: `位置 [${f.position.join(',')}]`, data: { position: f.position } });
  }

  private settleIdle(): void {
    for (const id of this.dispatchedWhileBusy) {
      this.dispatchedWhileBusy.delete(id);
      this.settle(id, 'completed', 'Numen reports no pending native work for this body (inferred completion; verify effects).', { inferred: 'workPending=false' });
    }
  }

  private async reconcileAccepted(): Promise<void> {
    for (const r of [...this.receipts.values()]) {
      if (r.terminal) continue;
      try {
        const out = await this.port.result(r.requestId);
        const status = stateOf(out);
        if (status !== 'accepted') { this.dispatchedWhileBusy.delete(r.requestId); this.settle(r.requestId, status, out.text, out.data); }
      } catch (error) { this.fail(error); }
    }
  }

  private onPortEvent(e: NumenPortEvent): void {
    if (e.requestId && e.state) {
      const status = e.state === 'completed' ? 'completed' : e.state === 'unknown' ? 'unknown' : 'failed';
      this.dispatchedWhileBusy.delete(e.requestId);
      this.settle(e.requestId, status, e.text, e.data, e.raw);
      return;
    }
    if (e.kind === 'death' && this.state === 'ready') this.state = 'dead';
    if (e.kind === 'respawn' && this.state === 'dead') this.state = 'ready';
    if (e.kind === 'connection' && e.data.connected === false && this.state !== 'destroyed') this.setState('reconnecting', e.text);
    this.emit({ kind: e.kind, text: e.text, data: e.data, raw: e.raw });
  }

  protected async doAct(action: BodyAction & { verb: ActionVerb; requestId: string }, signal?: AbortSignal): Promise<ActionReceipt> {
    if (action.verb === 'stop') return this.doStop('stop action', action.requestId);
    if (action.verb === 'observe' && !this.catalog.some(t => t.name === 'status')) {
      const o = await this.port.observe(signal);
      return this.receipt(action.requestId, 'observe', 'completed', o.text, { data: o });
    }
    let tool: string, args: Record<string, unknown>;
    if (action.verb === 'native') { tool = action.name!; args = action.args ?? {}; }
    else if (action.verb === 'observe') { tool = 'status'; args = { details: true }; }
    else {
      const names = new Set(this.catalog.map(t => t.name));
      const m = VERB_MAPS[action.verb]!.find(x => names.has(x.tool))!;
      tool = m.tool; args = m.map(action.args ?? {});
    }
    const out = await this.port.call({ id: action.requestId, tool, args, ...(signal ? { signal } : {}) });
    const status = stateOf(out);
    if (status === 'accepted') this.dispatchedWhileBusy.add(action.requestId);
    return this.receipt(action.requestId, action.verb, status, out.text, { executionId: action.requestId, ...(out.data ? { data: out.data } : {}) });
  }

  protected async doResult(requestId: string, signal?: AbortSignal): Promise<ActionReceipt | null> {
    const known = this.receipts.get(requestId);
    const out = await this.port.result(requestId, signal);
    const status = stateOf(out);
    return this.receipt(requestId, known?.verb ?? 'native', status, out.text, { executionId: requestId, ...(out.data ? { data: out.data } : {}) });
  }

  protected async doStop(reason: string, requestId = newRequestId('stop')): Promise<ActionReceipt> {
    if (!this.port.cancel) return this.receipt(requestId, 'stop', 'unsupported', 'this Numen transport has no stop; the hosting coordinator pauses the body (mode switch)');
    const r = await this.port.cancel(reason);
    return this.receipt(requestId, 'stop', r.ok ? 'completed' : 'unknown', r.text);
  }

  async snapshot(signal?: AbortSignal): Promise<BodySnapshot> {
    const [f, o, b] = await Promise.all([
      this.port.facts ? this.port.facts(signal).catch(() => null) : Promise.resolve(null),
      this.port.observe(signal).catch(() => null),
      this.port.battlefield ? this.port.battlefield(signal).catch(() => null) : Promise.resolve(null),
    ]);
    if (f) this.lastFacts = f;
    return { sampledAt: this.now().toISOString(), lifeState: f ? (f.health > 0 ? 'alive' : 'dead') : 'unknown',
      position: f ? { x: f.position[0], y: f.position[1], z: f.position[2] } : null, dimension: f?.dimension ?? null,
      health: f?.health ?? null, maxHealth: f?.maxHealth ?? null, food: f?.food ?? null, inventory: null, entities: b ?? null,
      text: o?.text ?? null, raw: { facts: f, observe: o } };
  }

  protected healthExtra() { return { extra: { transport: this.transport, catalog: this.catalog.map(t => t.name), workPending: this.lastFacts?.workPending ?? null } }; }
}

/** numen-hosting receipt states (completed/partial/blocked/cancelled/unknown) → unified status. */
export function stateOf(out: ToolOutcomeLike): Exclude<ActionReceipt['status'], 'rejected' | 'unsupported' | 'blocked_by_safety'> {
  const s = (out.meta as { state?: string } | undefined)?.state;
  if (s === 'completed') return 'completed';
  if (s === 'partial' || s === 'pending') return 'accepted';
  if (s === 'unknown') return 'unknown';
  if (s === 'blocked' || s === 'cancelled') return 'failed';
  return out.failed ? 'failed' : 'completed';
}

/**
 * Hosted Numen (numen-hosting `HostedRoles` + `hosted_body`): reuses `numenCorePort` from paper/integrations/numen-hosting.
 * The coordinator owns attach/switch/release; this adapter only drives the body while the role is in `harness` mode at `epoch`.
 */
export async function numenHostedAdapter(input: { hosting: unknown; role: { serverId: string; roleUuid: string; name: string; ownerId?: string; numenOwnerUuid?: string }; epoch: number } & Omit<NumenAdapterOptions, 'port' | 'epoch'>): Promise<NumenBodyAdapter> {
  const { numenCorePort } = await import('../../../../paper/integrations/numen-hosting/src/core-port.mjs');
  const port = numenCorePort(input.hosting, input.role, input.epoch) as NumenBodyPort;
  return new NumenBodyAdapter({ ...input, port: Object.assign(port, { transport: 'numen-hosted' }), epoch: input.epoch, ownerId: input.ownerId ?? input.role.numenOwnerUuid ?? input.role.ownerId ?? null });
}
