/**
 * mcbot transport for a Numen body: the owner's authenticated Java connection talks to the QiandengjiMcbot Paper plugin
 * (paper/integrations/mcbot) over plugin channels `mcbot:c2s` / `mcbot:s2c`, varint-length-framed UTF-8 JSON (Wire.java, ≤32765 bytes).
 *
 * Implements agent-mc-world's `NumenBodyPort` so it can also be handed to `NumenClientWorld`. Protocol facts are taken from
 * McbotPaper.java / Policy.java / Toolbox.java (kinds: companion_status, summon, dismiss, task_begin, task_end, cancel, authorize,
 * tool_call → companion_state, summon_result, dismiss_result, cancel_ack, tool_result, job_ack, job_event).
 * The frame codec is re-implemented here (12 lines) because the only JS copy is inside the probe script, which is not importable.
 *
 * Safety: a request is sent once. RESULT_UNKNOWN / timeouts are reported as `unknown`; nothing is replayed automatically
 * (the plugin replays a cached reply only for an identical (task, seq) and never re-executes, but we still don't rely on it).
 */
import type { NumenBodyFacts, NumenBodyPort } from '../../../agent-mc-world/src/client/numen-client.ts';
import type { NumenPortEvent, NumenPortExtensions } from './numen.ts';
import type { BodyEventKind } from './types.ts';

export const MCBOT_C2S = 'mcbot:c2s';
export const MCBOT_S2C = 'mcbot:s2c';
const MAX_FRAME = 32765;

/** Tools the Paper backend executes (Policy.TOOLS) with the argument names Toolbox/Containers accept. */
export const MCBOT_TOOLS: Record<string, { args: string[]; readOnly: boolean; description: string }> = {
  status: { args: ['details', 'recovery'], readOnly: true, description: 'position, health, food, held item, dimension (+inventory with details)' },
  inventory: { args: [], readOnly: true, description: '36 slots and equipment' },
  scan_area: { args: ['r', 'items_only'], readOnly: true, description: 'entities (with UUIDs), workstations and terrain nearby (r ≤ 32)' },
  find_resource: { args: ['targets', 'r'], readOnly: true, description: 'find blocks/containers (≤8 targets, line of sight)' },
  inspect_block: { args: ['x', 'y', 'z', 'offset'], readOnly: true, description: 'one block state' },
  equip: { args: ['slot', 'target'], readOnly: false, description: 'move an exact inventory slot to the main hand' },
  consume: { args: ['slot'], readOnly: false, description: 'eat/drink' },
  craft: { args: ['item', 'count', 'query', 'recipe'], readOnly: false, description: '2x2 or nearby 3x3 crafting (query=true is read-only)' },
  smelt: { args: ['x', 'y', 'z', 'action', 'input_slot', 'input_count', 'fuel_slot', 'fuel_count', 'slot', 'count'], readOnly: false, description: 'furnace query/load/take' },
  break_block: { args: ['x', 'y', 'z'], readOnly: false, description: 'dig one block' },
  place_block: { args: ['x', 'y', 'z', 'item', 'face'], readOnly: false, description: 'place one block (face up only)' },
  attack: { args: ['entity_id', 'target_uuid', 'max_hits', 'authorization_id'], readOnly: false, description: 'bounded melee on a visible unnamed hostile mob' },
  follow: { args: ['target_uuid', 'distance', 'seconds', 'protect_owner'], readOnly: false, description: 'follow an entity' },
  collect: { args: ['x', 'y', 'z', 'r'], readOnly: false, description: 'pick up dropped items around a point' },
  move_to: { args: ['x', 'y', 'z', 'may_alter_terrain', 'authorization_id', 'walk_only'], readOnly: false, description: 'native pathfinding (≤64 blocks)' },
  transfer: { args: ['x', 'y', 'z', 'dir', 'item'], readOnly: false, description: 'container in/out' },
  wait: { args: ['seconds', 'ticks'], readOnly: false, description: 'bounded wait' },
  command: { args: ['command'], readOnly: false, description: '/mycli gameplay command (whitelist)' },
  use_item: { args: ['seconds'], readOnly: false, description: 'use the held item' },
  use_block: { args: ['x', 'y', 'z'], readOnly: false, description: 'right-click a block' },
};

export function encodeMcbotFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (body.length > MAX_FRAME) throw new Error('mcbot frame too large');
  const prefix: number[] = []; let n = body.length;
  do { const b = n & 127; n >>>= 7; prefix.push(b | (n ? 128 : 0)); } while (n);
  return Buffer.concat([Buffer.from(prefix), body]);
}
export function decodeMcbotFrame(data: Uint8Array): Record<string, unknown> | null {
  let n = 0, i = 0, shift = 0;
  for (; i < 3; i++, shift += 7) { const b = data[i]; if (b === undefined) return null; n |= (b & 127) << shift; if (!(b & 128)) { i++; break; } }
  if (n > MAX_FRAME || data.length - i !== n) return null;
  try { const v = JSON.parse(Buffer.from(data.subarray(i)).toString('utf8')); return v && typeof v === 'object' && !Array.isArray(v) && typeof v.kind === 'string' ? v : null; }
  catch { return null; }
}

/** Mineflayer-like owner connection (only the raw protocol client is used). */
export interface McbotConnectionLike {
  _client: { write(name: 'custom_payload', packet: { channel: string; data: Buffer }): void;
    on(event: 'custom_payload', fn: (p: { channel: string; data: Uint8Array }) => void): unknown;
    off(event: 'custom_payload', fn: (p: { channel: string; data: Uint8Array }) => void): unknown };
}

type Outcome = Awaited<ReturnType<NumenBodyPort['call']>>;
interface Pending { resolve: (o: Outcome) => void; timer: ReturnType<typeof setTimeout>; tool: string; id: string }
type PortEvent = NumenPortEvent;

export interface McbotPortOptions {
  connection: McbotConnectionLike;
  /** Companion name (Policy.bodyName: 2–16 [A-Za-z0-9_]). */
  name: string;
  serverId: string;
  /** Companion UUID if already known; otherwise learned from summon_result/companion_state. */
  uuid?: string;
  /** Summon on connect (re-summoning the same name reuses identity and inventory). Default true. */
  summon?: boolean;
  /** Dismiss (native sleep; identity kept) on release. Default false. */
  dismissOnRelease?: boolean;
  timeoutMs?: number;
}

export class McbotNumenPort implements NumenBodyPort, NumenPortExtensions {
  readonly transport = 'mcbot';
  private uuid: string | null;
  private bodyId: string | null = null;
  private bodyState: 'alive' | 'dead' | null = null;
  private seq = 0;
  private taskId = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly jobs = new Map<string, { id: string; tool: string }>();
  private readonly ledger = new Map<string, Outcome>();
  private readonly listeners = new Set<(e: PortEvent) => void>();
  private stateWaiters: Array<(m: Record<string, unknown>) => void> = [];
  private lastStatus: { data: Record<string, unknown>; at: number } | null = null;
  private readonly onPacket = (p: { channel: string; data: Uint8Array }) => { if (p.channel === MCBOT_S2C) { const m = decodeMcbotFrame(p.data); if (m) this.onMessage(m); } };
  private attached = false;

  /** Present only with `dismissOnRelease` (then destroy = native dismiss/sleep; identity and inventory are kept). */
  readonly release?: () => Promise<void>;

  constructor(private readonly options: McbotPortOptions) {
    this.uuid = options.uuid ?? null;
    if (options.dismissOnRelease) this.release = async () => { if (this.attached) this.send({ kind: 'dismiss', name: this.options.name }); };
  }

  get identity() { return { server: this.options.serverId, uuid: this.uuid ?? '', name: this.options.name }; }
  generation() { return this.bodyId; }

  private send(m: Record<string, unknown>) { this.options.connection._client.write('custom_payload', { channel: MCBOT_C2S, data: encodeMcbotFrame(m) }); }
  private emit(e: PortEvent) { for (const l of this.listeners) { try { l(e); } catch { /* isolated */ } } }
  onEvent(listener: (e: PortEvent) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  private waitState(kinds: string[], ms: number): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.stateWaiters = this.stateWaiters.filter(w => w !== fn); reject(new Error(`mcbot ${kinds.join('/')} timed out`)); }, ms);
      const fn = (m: Record<string, unknown>) => { if (!kinds.includes(String(m.kind))) return; clearTimeout(timer); this.stateWaiters = this.stateWaiters.filter(w => w !== fn); resolve(m); };
      this.stateWaiters.push(fn);
    });
  }

  async connect() {
    if (!this.attached) { this.options.connection._client.on('custom_payload', this.onPacket); this.attached = true; }
    const ms = this.options.timeoutMs ?? 10_000;
    const reply = this.waitState(this.options.summon === false ? ['companion_state'] : ['summon_result'], ms);
    this.send(this.options.summon === false ? { kind: 'companion_status' } : { kind: 'summon', name: this.options.name });
    const m = await reply;
    const uuid = typeof m.companion_uuid === 'string' && m.companion_uuid ? m.companion_uuid : null;
    const ready = !!uuid && m.body_state === 'alive' && !String(m.text ?? '').startsWith('DENIED');
    if (uuid && this.uuid && uuid !== this.uuid) throw new Error('mcbot companion UUID differs from the configured identity');
    if (uuid) this.uuid = uuid;
    if (ready) {
      this.taskId = Date.now();
      this.send({ kind: 'task_begin', task_id: this.taskId, read_only: false, autonomous: true, body_id: this.bodyId });
    }
    return { uuid: this.uuid ?? '', server: this.options.serverId, ready };
  }

  async disconnect() {
    if (!this.attached) return;
    if (this.taskId) this.send({ kind: 'task_end', task_id: this.taskId });
    this.taskId = 0;
    for (const [seq, p] of this.pending) { clearTimeout(p.timer); this.pending.delete(seq); p.resolve(this.unknown(p.id, 'connection detached before a reply')); }
    this.options.connection._client.off('custom_payload', this.onPacket); this.attached = false;
  }


  async cancel(_reason: string) {
    const ack = this.waitState(['cancel_ack'], this.options.timeoutMs ?? 10_000).catch(() => null);
    this.send({ kind: 'cancel', task_id: this.taskId || 0 });
    const m = await ack;
    return { ok: !!m, text: m ? String(m.text ?? 'cancel submitted') : 'cancel not acknowledged' };
  }

  async catalog() {
    return Object.entries(MCBOT_TOOLS).map(([name, t]) => ({ name, description: t.description,
      parameters: { type: 'object', additionalProperties: false, properties: Object.fromEntries(t.args.map(a => [a, {}])) } }));
  }

  private unknown(id: string, text: string): Outcome { return { text: `RESULT_UNKNOWN: ${text}; query state, do not replay`, failed: true, meta: { backend: 'mcbot', requestId: id, state: 'unknown' } }; }

  async call({ id, tool, args, signal }: { id: string; tool: string; args: Record<string, unknown>; signal?: AbortSignal }): Promise<Outcome> {
    const prior = this.ledger.get(id);
    if (prior) return prior;
    if (!MCBOT_TOOLS[tool]) return { text: `UNSUPPORTED_TOOL: ${tool}`, failed: true, meta: { backend: 'mcbot', requestId: id, state: 'blocked' } };
    if (!this.attached) return { text: 'mcbot port not connected', failed: true, meta: { backend: 'mcbot', requestId: id, state: 'blocked' } };
    signal?.throwIfAborted();
    const seq = ++this.seq;
    const out = new Promise<Outcome>(resolve => {
      const timer = setTimeout(() => { this.pending.delete(seq); resolve(this.unknown(id, 'reply timed out')); }, this.options.timeoutMs ?? 10_000);
      this.pending.set(seq, { resolve, timer, tool, id });
    });
    this.send({ kind: 'tool_call', seq, task_id: this.taskId, tool, args, accept: true, ...(this.bodyId ? { body_id: this.bodyId } : {}) });
    const o = await out;
    this.ledger.set(id, o);
    return o;
  }

  async result(id: string): Promise<Outcome> {
    return this.ledger.get(id) ?? { text: 'no local record of this request (mcbot has no server-side receipt query)', failed: true, meta: { backend: 'mcbot', requestId: id, state: 'unknown' } };
  }

  async observe() {
    const o = await this.call({ id: `obs-${Date.now()}-${this.seq + 1}`, tool: 'status', args: { details: false } });
    return { text: o.text, sampledAt: Date.now(), uuid: this.uuid ?? '', server: this.options.serverId };
  }

  async facts(): Promise<NumenBodyFacts | null> {
    const o = await this.call({ id: `facts-${Date.now()}-${this.seq + 1}`, tool: 'status', args: {} });
    const d = o.data as Record<string, unknown> | undefined;
    if (o.failed || !d || typeof d.x !== 'number') return null;
    this.lastStatus = { data: d, at: Date.now() };
    return { uuid: this.uuid ?? '', server: this.options.serverId, sampledAt: Date.now(), health: Number(d.hp), maxHealth: 20, food: Number(d.food),
      dimension: String(d.dimension), position: [Number(d.x), Number(d.y), Number(d.z)], workPending: [...this.jobs.values()].length > 0 };
  }

  private onMessage(m: Record<string, unknown>): void {
    for (const w of [...this.stateWaiters]) w(m);
    const kind = String(m.kind);
    if (kind === 'companion_state' || kind === 'summon_result' || kind === 'dismiss_result') {
      if (typeof m.body_id === 'string') this.bodyId = m.body_id;
      const prev = this.bodyState;
      const next = m.body_state === 'dead' ? 'dead' : m.body_state === 'alive' ? 'alive' : null;
      this.bodyState = next;
      const ev: BodyEventKind = prev === 'alive' && next === 'dead' ? 'death' : prev === 'dead' && next === 'alive' ? 'respawn' : next === null ? 'connection' : 'lifecycle';
      this.emit({ kind: ev, text: String(m.text ?? kind), data: { mcbot: kind, bodyState: next, bodyId: this.bodyId, ...(ev === 'connection' ? { connected: false } : {}) }, raw: m });
      return;
    }
    if (kind === 'tool_result') {
      const seq = Number(m.seq);
      const p = this.pending.get(seq);
      if (!p) return;
      clearTimeout(p.timer); this.pending.delete(seq);
      const text = String(m.feedback ?? '');
      const state = m.ok === true ? 'completed' : /^RESULT_UNKNOWN/.test(text) ? 'unknown' : 'blocked';
      p.resolve({ text, ...(state !== 'completed' ? { failed: true as const } : {}), meta: { backend: 'mcbot', requestId: p.id, state, tool: p.tool },
        ...(m.data && typeof m.data === 'object' ? { data: m.data as Record<string, unknown> } : {}) });
      return;
    }
    if (kind === 'job_ack') {
      const p = this.pending.get(Number(m.seq));
      if (!p) return;
      clearTimeout(p.timer); this.pending.delete(Number(m.seq));
      this.jobs.set(String(m.job_id), { id: p.id, tool: p.tool });
      p.resolve({ text: String(m.text ?? 'ACCEPTED'), meta: { backend: 'mcbot', requestId: p.id, state: 'partial', jobId: m.job_id, tool: p.tool } });
      return;
    }
    if (kind === 'job_event') {
      const job = this.jobs.get(String(m.job_id));
      if (!job) return;
      this.jobs.delete(String(m.job_id));
      const phase = String(m.phase);
      const state = phase === 'done' ? 'completed' : phase === 'cancelled' ? 'cancelled' : 'blocked';
      const outcome: Outcome = { text: String(m.text ?? phase), ...(state !== 'completed' ? { failed: true as const } : {}), meta: { backend: 'mcbot', requestId: job.id, state, tool: job.tool },
        ...(m.data && typeof m.data === 'object' ? { data: m.data as Record<string, unknown> } : {}) };
      this.ledger.set(job.id, outcome);
      this.emit({ kind: 'action_result', text: outcome.text, data: { tool: job.tool, phase }, requestId: job.id, state, raw: m });
      return;
    }
    if (kind === 'cancel_ack') return;
    this.emit({ kind: 'system_message', text: String(m.text ?? m.feedback ?? kind), data: { mcbot: kind }, raw: m });
  }
}
