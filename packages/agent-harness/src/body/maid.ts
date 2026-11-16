/**
 * Touhou Little Maid body: an existing TLM maid NPC owned by the authenticated player, controlled through the Qiandengji maid bridge
 * (qiandengji-maids/v1). Reuses paper/integrations/touhou-maids/agent/maid-port.mjs unchanged: `createMaidPort(bot)` (plugin channel
 * `qiandengji:maid_request` with `/qdmaid` + `QD_MAID` system-line fallback, request pacing, reply correlation, effect verification),
 * `MAID_TOOL` (action catalog + schema) and its write/receipt rules (writes need a retained requestId; unknown is never retried).
 *
 * The maid is autonomous (native TLM AI): body-neutral motion verbs such as move/attack/mine are NOT offered; the harness sets modes
 * (follow/stay/sit/task/schedule) and reads context/inventory/receipts instead.
 */
import { createMaidPort, MAID_TOOL } from '../../../../paper/integrations/touhou-maids/agent/maid-port.mjs';
import { ArgumentError, BaseBodyAdapter, newRequestId, only, optInt, str } from './base.ts';
import type { ActionReceipt, ActionSupport, ActionVerb, BodyAction, BodyCapabilities, BodyEventKind, BodyIdentity, BodySnapshot, NativeActionInfo } from './types.ts';
import { BODY_PROTOCOL } from './types.ts';

/** Mineflayer-like owner connection required by createMaidPort (raw client with uuid + chat + messagestr events). */
export interface MaidConnectionLike {
  _client: { uuid?: string; write: (...a: any[]) => void; on: (...a: any[]) => unknown; off: (...a: any[]) => unknown; once: (...a: any[]) => unknown };
  chat: (text: string) => void;
  on: (...a: any[]) => unknown;
  off: (...a: any[]) => unknown;
  player?: { uuid?: string };
}
interface MaidPort { request(args: Record<string, unknown>): Promise<unknown>; close(): void; readonly transport: string; readonly workshopSupported: boolean }
interface MaidPortOptions { timeoutMs?: number; onDialogue?: (v: MaidReply) => void; onLifecycle?: (v: MaidReply) => void; onChatResult?: (v: MaidReply) => void }
/** maid-port.mjs is untyped JS; this is its documented signature. */
const openMaidPort = createMaidPort as unknown as (bot: MaidConnectionLike, options: MaidPortOptions) => MaidPort;
interface MaidReply { ok: boolean; action?: string; requestId?: string; status?: string; reason?: string; error?: string; data?: Record<string, any>; sampledAt?: string; retryAllowed?: false; operationId?: string }

export interface MaidAdapterOptions {
  connection: MaidConnectionLike;
  /** Exact maid UUID. If omitted, spawn binds the only owned maid from `list` (fails when there are 0 or several). */
  maidId?: string;
  serverId: string;
  timeoutMs?: number;
  /** Read `context` every pollMs to report life/position changes (0 = off). Default 0 (lifecycle events are pushed by the bridge). */
  pollMs?: number;
  /** Query `receipt` for accepted (pending/reserved) writes every resultPollMs (0 = off). Default 3000. Never re-sends the write. */
  resultPollMs?: number;
  now?: () => Date;
}

const WRITES = new Set(['brain', 'chat', 'talk', 'follow', 'recall', 'stay', 'speak', 'ack', 'sit', 'task', 'make', 'schedule', 'pickup', 'transfer', 'equip', 'skin', 'voice', 'voice-test', 'mute', 'resource-pack', 'rename', 'cast']);
const ALL_ACTIONS: string[] = (MAID_TOOL.parameters.properties.action as { enum: string[] }).enum;

const ACTIONS: Partial<Record<ActionVerb, ActionSupport & { action: string }>> = {
  follow: { action: 'follow', native: '/qdmaid follow', async: false, args: [], notes: 'follows the owner (the authenticated player) only' },
  stay: { action: 'stay', native: '/qdmaid stay', async: false, args: [] },
  sit: { action: 'sit', native: '/qdmaid sit', async: false, args: [] },
  recall: { action: 'recall', native: '/qdmaid recall', async: false, args: [], notes: 'teleports/brings the maid to the owner; reports actual arrival' },
  chat: { action: 'speak', native: '/qdmaid speak', async: false, args: ['text'], notes: 'the maid says host-provided text (≤140 chars)' },
  equip: { action: 'equip', native: '/qdmaid equip', async: false, args: ['hand', 'slot'] },
  transfer: { action: 'transfer', native: '/qdmaid transfer', async: false, args: ['direction', 'slot', 'count', 'playerSlot'] },
  craft: { action: 'make', native: '/qdmaid make (workshop)', async: true, args: ['workshopId', 'recipeId', 'quantity', 'inventory'], notes: 'read workshop first; settles via receipt' },
  cast: { action: 'cast', native: '/qdmaid cast', async: true, args: ['spellId'], notes: 'read context.companion.rpg.spells first' },
  pickup: { action: 'pickup', native: '/qdmaid pickup', async: false, args: ['enabled'], notes: 'toggles native item pickup mode' },
  observe: { action: 'context', native: '/qdmaid context', async: false, args: [] },
  inventory: { action: 'inventory', native: '/qdmaid inventory', async: false, args: [] },
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class MaidBodyAdapter extends BaseBodyAdapter {
  readonly kind = 'maid' as const;
  private port: MaidPort | null = null;
  private maidId: string | null;
  private name: string | null = null;
  private lastContext: Record<string, any> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private resultTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: MaidAdapterOptions) { super(options.now); this.maidId = options.maidId?.toLowerCase() ?? null; }

  private owner(): string | null { return this.options.connection._client.uuid ?? this.options.connection.player?.uuid ?? null; }

  identity(): BodyIdentity | null {
    if (!this.maidId) return null;
    const dim = typeof this.lastContext?.dimension === 'string' ? this.lastContext.dimension : null;
    return { kind: 'maid', bodyId: this.maidId, name: this.name, ownerId: this.owner(),
      world: { serverId: this.options.serverId, worldKey: dim, dimension: dim },
      scope: { realm: this.options.serverId, account: `maid:${this.maidId}`, agent: (this.name ?? this.maidId).toLowerCase() },
      generation: this.port ? this.port.transport : null };
  }

  capabilities(): BodyCapabilities {
    const actions: BodyCapabilities['actions'] = {};
    for (const [verb, s] of Object.entries(ACTIONS) as Array<[ActionVerb, ActionSupport & { action: string }]>) {
      if (verb === 'craft' && this.port && !this.port.workshopSupported) continue;
      const { action: _a, ...support } = s; actions[verb] = support;
    }
    actions.stop = { native: '/qdmaid stay', async: false, args: [], notes: 'stop = switch to stay mode (no generic cancel in TLM)' };
    const nativeActions: NativeActionInfo[] = ALL_ACTIONS.map(a => ({ name: a, readOnly: !WRITES.has(a) || a === 'brain',
      description: `qiandengji-maids/v1 ${a}`, schema: MAID_TOOL.parameters as unknown as Record<string, unknown> }));
    const events: BodyEventKind[] = ['dialogue', 'death', 'respawn', 'lifecycle', 'action_result', 'safety', ...(this.options.pollMs ? ['status', 'dimension'] as BodyEventKind[] : [])];
    return { protocol: BODY_PROTOCOL, kind: 'maid', transport: this.port ? `maid-${this.port.transport}` : 'maid', actions, nativeActions, events,
      snapshot: ['lifeState', 'dimension', 'position', 'inventory', 'text'],
      lifecycle: { spawn: 'bind-existing', reconnect: true, destroy: 'detach' }, perception: this.options.pollMs ? 'push+poll' : 'push',
      safety: { antiCheatStop: true, paceLimits: true, nativeGuards: ['maid-port command pacing (80ms plugin / 1.1s chat)', 'max 8 pending', 'TLM ownership', 'no automatic retry/recreate'] },
      limits: ['Autonomous NPC: no direct move/attack/mine/place; use modes (follow/stay/sit/task/schedule) and recall.',
        'Never creates or recreates a maid; spawn only binds an existing owned maid.', 'Uses the owner connection; when it closes the port closes (no auto reconnect inside maid-port).'] };
  }

  protected connected(): boolean { return !!this.port && (this.state === 'ready' || this.state === 'dead'); }

  protected async doSpawn(): Promise<void> {
    if (!this.port) {
      this.port = openMaidPort(this.options.connection, { timeoutMs: this.options.timeoutMs ?? 5000,
        onDialogue: (v: MaidReply) => this.onDialogue(v), onLifecycle: (v: MaidReply) => this.onLifecycle(v), onChatResult: (v: MaidReply) => this.onChatResult(v) });
      this.options.connection._client.once('end', () => { this.port = null; if (this.state !== 'destroyed') this.setState('detached', 'owner connection closed'); });
    }
    if (!this.maidId) {
      const list = await this.port.request({ action: 'list' }) as MaidReply;
      const owned = ((list.ok ? list.data?.maids : null) ?? []) as Array<{ maidId?: string; name?: string }>;
      if (owned.length !== 1 || !UUID.test(owned[0]!.maidId ?? '')) throw new Error(owned.length ? 'several owned maids: configure maidId' : `no owned maid found (${list.reason ?? list.error ?? 'empty list'})`);
      this.maidId = owned[0]!.maidId!.toLowerCase(); this.name = owned[0]!.name ?? null;
    }
    const ctx = await this.port.request({ action: 'context', maidId: this.maidId }) as MaidReply;
    if (!ctx.ok) throw new Error(`maid context unavailable: ${ctx.reason ?? ctx.error ?? ctx.status}`);
    this.applyContext(ctx.data!);
    if (this.options.pollMs) { this.pollTimer = setInterval(() => void this.poll(), this.options.pollMs); this.pollTimer.unref?.(); }
    const rms = this.options.resultPollMs ?? 3000;
    if (rms > 0) { this.resultTimer = setInterval(() => void this.reconcile(), rms); this.resultTimer.unref?.(); }
  }

  /** Settle accepted writes from their receipts (same operationId; the write itself is never repeated). */
  async reconcile(): Promise<void> {
    for (const r of [...this.receipts.values()]) {
      if (r.terminal) continue;
      try { const out = await this.doResult(r.requestId); if (out?.terminal) this.settle(r.requestId, out.status as 'completed', out.text, out.data); }
      catch (error) { this.fail(error); }
    }
  }

  protected async doDestroy(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer); if (this.resultTimer) clearInterval(this.resultTimer);
    this.pollTimer = this.resultTimer = null;
    this.port?.close(); this.port = null;
  }

  private applyContext(data: Record<string, any>): void {
    const prev = this.lastContext;
    this.lastContext = data;
    if (typeof data.name === 'string') this.name = data.name;
    if (data.lifeState === 'dead' && this.state === 'ready') this.state = 'dead';
    if (data.lifeState === 'alive' && this.state === 'dead') this.state = 'ready';
    if (prev && prev.lifeState !== data.lifeState) this.emit({ kind: data.lifeState === 'dead' ? 'death' : data.lifeState === 'alive' ? 'respawn' : 'status',
      text: `女仆 ${this.name ?? this.maidId} ${prev.lifeState} → ${data.lifeState}`, data: { lifeState: data.lifeState } });
    if (prev && prev.dimension !== data.dimension && data.dimension) this.emit({ kind: 'dimension', text: `女仆维度 ${prev.dimension} → ${data.dimension}`, data: { from: prev.dimension, to: data.dimension } });
  }

  async poll(): Promise<void> {
    if (!this.port || !this.maidId) return;
    try { const r = await this.port.request({ action: 'context', maidId: this.maidId }) as MaidReply; if (r.ok) this.applyContext(r.data!); } catch (error) { this.fail(error); }
  }

  private mine(v: MaidReply): boolean { return !!this.maidId && typeof v.data?.maidId === 'string' && v.data.maidId.toLowerCase() === this.maidId; }

  private onDialogue(v: MaidReply): void {
    if (!this.mine(v)) return;
    const d = v.data!;
    this.emit({ kind: 'dialogue', text: String(d.text ?? d.message ?? 'dialogue'), severity: 3,
      data: { eventId: d.eventId, sessionKey: d.sessionKey, speaker: d.speaker ?? d.playerName ?? null, memoryNamespace: d.memoryNamespace ?? null, untrusted: true }, raw: v });
  }
  private onLifecycle(v: MaidReply): void {
    if (!this.mine(v)) return;
    const d = v.data!;
    if (d.lifeState === 'dead') {
      if (this.state === 'ready') this.state = 'dead';
      const death = d.death ?? {};
      this.emit({ kind: 'death', text: `[女仆·死亡] ${death.name ?? this.name ?? ''}${death.position ? ` @ ${JSON.stringify(death.position)}` : ''}`, data: { lifeState: 'dead', death, eventId: v.requestId }, raw: v });
    } else if (d.recovery) {
      if (this.state === 'dead') this.state = 'ready';
      this.emit({ kind: 'respawn', text: `[女仆·恢复] ${d.recovery.name ?? this.name ?? ''}（观察时间，不是实际复活时间）`, data: { lifeState: d.lifeState, recovery: d.recovery }, raw: v });
    } else this.emit({ kind: 'lifecycle', text: `女仆状态 ${d.lifeState}`, data: { lifeState: d.lifeState }, raw: v });
    if (this.lastContext) this.lastContext = { ...this.lastContext, lifeState: d.lifeState };
  }
  private onChatResult(v: MaidReply): void {
    if (!this.mine(v)) return;
    const d = v.data!;
    const id = String(d.operationId ?? v.requestId);
    const ok = d.status === 'replied';
    const reply = d.observation?.reply;
    if (this.receipts.has(id)) this.settle(id, ok ? 'completed' : d.status === 'unknown' ? 'unknown' : 'failed', ok ? `回复：${reply ?? ''}` : `chat ${d.status}`, d, v);
    else this.emit({ kind: 'dialogue', text: ok ? String(reply ?? '') : `chat ${d.status}`, data: { operationId: id, status: d.status, conversation: d.observation?.conversation ?? null }, raw: v });
  }

  /** Unified verb → maid-port request args (validated again by maidCommand inside the port). */
  private map(a: BodyAction & { verb: ActionVerb; requestId: string }): Record<string, unknown> {
    const args = a.args ?? {};
    const base = { maidId: this.maidId, requestId: a.requestId };
    if (a.verb === 'native') {
      const act = a.name!;
      const extra = { ...args }; delete extra.maidId; delete extra.requestId;
      return act === 'list' || act === 'nearby' ? { action: act, ...(WRITES.has(act) ? { requestId: a.requestId } : {}), ...extra }
        : { action: act, maidId: this.maidId, ...(WRITES.has(act) && !(act === 'brain' && extra.choice === undefined) ? { requestId: a.requestId } : {}), ...extra };
    }
    if (a.verb === 'stop') return { action: 'stay', ...base };
    const s = ACTIONS[a.verb];
    if (!s) throw new ArgumentError(`unsupported verb ${a.verb}`);
    switch (a.verb) {
      case 'follow': case 'stay': case 'sit': case 'recall':
        only(args, a.verb === 'follow' ? ['player'] : [], a.verb);
        if (a.verb === 'follow' && args.player !== undefined) throw new ArgumentError('a maid only follows its owner; omit player');
        return { action: s.action, ...base };
      case 'chat': only(args, ['text'], 'chat'); return { action: 'speak', ...base, text: str(args.text, 'text', 140) };
      case 'equip': only(args, ['hand', 'slot'], 'equip'); return { action: 'equip', ...base, hand: args.hand ?? 'main', slot: optInt(args.slot, 'slot', 0, 255) };
      case 'transfer': only(args, ['direction', 'slot', 'count', 'playerSlot'], 'transfer');
        return { action: 'transfer', ...base, direction: args.direction, slot: args.slot, count: args.count ?? 1, ...(args.playerSlot !== undefined ? { playerSlot: args.playerSlot } : {}) };
      case 'craft': only(args, ['workshopId', 'recipeId', 'quantity', 'inventory'], 'craft');
        return { action: 'make', ...base, workshopId: args.workshopId, recipeId: args.recipeId, ...(args.quantity !== undefined ? { quantity: args.quantity } : {}), ...(args.inventory ? { inventory: args.inventory } : {}) };
      case 'cast': only(args, ['spellId'], 'cast'); return { action: 'cast', ...base, spellId: str(args.spellId, 'spellId', 48) };
      case 'pickup': only(args, ['enabled'], 'pickup'); return { action: 'pickup', ...base, enabled: args.enabled ?? true };
      case 'observe': only(args, [], 'observe'); return { action: 'context', maidId: this.maidId };
      case 'inventory': only(args, [], 'inventory'); return { action: 'inventory', maidId: this.maidId };
      default: throw new ArgumentError(`unsupported verb ${a.verb}`);
    }
  }

  protected async doAct(action: BodyAction & { verb: ActionVerb; requestId: string }): Promise<ActionReceipt> {
    const req = this.map(action);
    const r = await this.port!.request(req) as MaidReply;
    return this.fromReply(action.requestId, action.verb, String(req.action), r);
  }

  private fromReply(requestId: string, verb: ActionVerb, action: string, r: MaidReply): ActionReceipt {
    if (r.status === 'not_dispatched') return this.receipt(requestId, verb, 'rejected', `not dispatched: ${r.reason ?? r.error ?? 'refused'}`, { data: r });
    if (!r.ok) {
      const unknown = r.status === 'unknown' || r.status === 'unavailable';
      return this.receipt(requestId, verb, unknown ? 'unknown' : 'failed', r.error ?? r.reason ?? 'maid bridge refused', { executionId: requestId, data: r });
    }
    const d = r.data ?? {};
    if (action === 'context') this.applyContext(d);
    const status = typeof d.status === 'string' ? d.status : null;
    // chat/make/cast may be pending: settle later through chat-result or receipt.
    if (status && ['pending', 'reserved'].includes(status)) return this.receipt(requestId, verb, 'accepted', `${action} ${status}`, { executionId: requestId, data: d });
    if (status && ['rejected', 'cancelled'].includes(status)) return this.receipt(requestId, verb, 'failed', `${action} ${status}${d.nextStep ? `: ${d.nextStep}` : ''}`, { executionId: requestId, data: d });
    if (status === 'unknown') return this.receipt(requestId, verb, 'unknown', `${action} result unknown; query receipt, do not retry`, { executionId: requestId, data: d });
    return this.receipt(requestId, verb, 'completed', summarize(action, d), { executionId: requestId, data: d });
  }

  protected async doResult(requestId: string): Promise<ActionReceipt | null> {
    const known = this.receipts.get(requestId);
    if (!this.port || !this.maidId || !known) return null;
    const native = ACTIONS[known.verb]?.action ?? (known.verb === 'stop' ? 'stay' : undefined);
    const r = await this.port.request({ action: 'receipt', maidId: this.maidId, operationId: requestId, ...(native && WRITES.has(native) ? { operationAction: native } : {}) }) as MaidReply;
    if (!r.ok) return null;
    const out = this.fromReply(requestId, known.verb, 'receipt', r);
    return out;
  }

  protected async doStop(reason: string): Promise<ActionReceipt> {
    const requestId = newRequestId('stop');
    const r = await this.port!.request({ action: 'stay', maidId: this.maidId, requestId }) as MaidReply;
    return this.fromReply(requestId, 'stop', 'stay', r.ok ? r : { ...r, error: `${r.error ?? r.reason ?? 'stay failed'} (${reason})` });
  }

  async snapshot(): Promise<BodySnapshot> {
    let ctx = this.lastContext, inv: unknown = null;
    if (this.port && this.maidId) {
      const [c, i] = await Promise.all([this.port.request({ action: 'context', maidId: this.maidId }), this.port.request({ action: 'inventory', maidId: this.maidId })]) as [MaidReply, MaidReply];
      if (c.ok) { this.applyContext(c.data!); ctx = c.data!; }
      if (i.ok) inv = i.data;
    }
    const p = ctx?.position ?? ctx?.lastSeenAlive?.position ?? null;
    const position = p && typeof p.x === 'number' ? { x: p.x, y: p.y, z: p.z } : Array.isArray(p) && p.length === 3 ? { x: p[0], y: p[1], z: p[2] } : null;
    return { sampledAt: this.now().toISOString(), lifeState: ctx?.lifeState === 'alive' ? 'alive' : ctx?.lifeState === 'dead' ? 'dead' : ctx?.lifeState === 'unloaded_or_unavailable' ? 'unloaded' : 'unknown',
      position, dimension: ctx?.dimension ?? ctx?.lastSeenAlive?.dimension ?? null, health: typeof ctx?.health === 'number' ? ctx.health : null,
      maxHealth: typeof ctx?.maxHealth === 'number' ? ctx.maxHealth : null, food: null, inventory: inv, entities: null,
      text: ctx ? summarize('context', ctx) : null, raw: ctx };
  }

  protected healthExtra() { return { extra: { transport: this.port?.transport ?? null, workshop: this.port?.workshopSupported ?? false, maidId: this.maidId } }; }
}

function summarize(action: string, d: Record<string, any>): string {
  if (action === 'context') return `女仆 ${d.name ?? d.maidId ?? ''}：${d.lifeState ?? '状态未知'}${d.mode ? `，模式 ${d.mode}` : ''}${d.dimension ? `，${d.dimension}` : ''}`;
  if (action === 'receipt') return `receipt ${d.action ?? ''} ${d.status ?? 'ok'}`;
  return `${action} ok${d.status ? ` (${d.status})` : ''}`;
}
