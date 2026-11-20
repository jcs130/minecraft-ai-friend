import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { ActionReceipt, ActionStatus, ActionVerb, BodyAction, BodyAdapter, BodyCapabilities, BodyEvent, BodyEventKind, BodyHealth,
  BodyIdentity, BodyKind, BodyLifecycleState, BodySnapshot } from './types.ts';
import { ACTION_VERBS } from './types.ts';

export type EventDraft = Omit<BodyEvent, 'at' | 'bodyKind' | 'bodyId' | 'data' | 'severity'> & { at?: string; data?: Record<string, unknown>; severity?: 1 | 2 | 3 };

const SEVERITY: Partial<Record<BodyEventKind, 1 | 2 | 3>> = { death: 3, whisper: 3, safety: 3, connection: 2, lifecycle: 2, respawn: 2,
  level: 2, dimension: 2, action_result: 2, server_status: 2, dialogue: 2, combat: 2 };

/** 8–48 chars: valid for maid-port ({1,48}), numen-hosting opaqueId ({8,120}) and agent-mc-world. */
const REQUEST_ID = /^[A-Za-z0-9_-]{8,48}$/;
export const newRequestId = (prefix = 'b') => `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 24)}`;

/**
 * Shared bookkeeping for adapters: listeners, lifecycle, counters, receipts ledger and argument checks.
 * Subclasses implement the body-specific parts (`doAct`, `doSpawn` …) and call `emit()` for perception events.
 */
export abstract class BaseBodyAdapter implements BodyAdapter {
  abstract readonly kind: BodyKind;
  protected state: BodyLifecycleState = 'detached';
  private readonly listeners = new Set<(e: BodyEvent) => void>();
  protected readonly receipts = new Map<string, ActionReceipt>();
  private readonly requests = new Map<string, { action: BodyAction; dispatching: boolean }>();
  private readonly startedAt = new Date().toISOString();
  protected readonly counters = { actions: 0, completed: 0, accepted: 0, failed: 0, unknown: 0, unsupported: 0, safetyBlocked: 0, events: 0, errors: 0 };
  private lastEventAt: string | null = null;
  private lastActionAt: string | null = null;
  protected lastError: string | null = null;
  protected readonly now: () => Date;

  constructor(now?: () => Date) { this.now = now ?? (() => new Date()); }

  abstract identity(): BodyIdentity | null;
  abstract capabilities(): BodyCapabilities;
  abstract snapshot(signal?: AbortSignal): Promise<BodySnapshot>;
  protected abstract doSpawn(signal?: AbortSignal): Promise<void>;
  protected abstract doDestroy(): Promise<void>;
  protected abstract doAct(action: Required<Pick<BodyAction, 'verb' | 'requestId'>> & BodyAction, signal?: AbortSignal): Promise<ActionReceipt>;
  protected abstract doResult(requestId: string, signal?: AbortSignal): Promise<ActionReceipt | null>;
  protected abstract doStop(reason: string): Promise<ActionReceipt>;
  protected connected(): boolean { return this.state === 'ready' || this.state === 'dead'; }

  lifecycle(): BodyLifecycleState { return this.state; }

  protected setState(next: BodyLifecycleState, text?: string, data: Record<string, unknown> = {}): void {
    if (next === this.state) return;
    const from = this.state; this.state = next;
    this.emit({ kind: 'lifecycle', text: text ?? `body ${from} → ${next}`, data: { from, to: next, ...data } });
  }

  async spawn(signal?: AbortSignal): Promise<void> {
    if (this.lifecycle() === 'ready') return;
    if (this.state === 'destroyed') throw new Error('body adapter was destroyed; create a new adapter');
    this.setState('spawning');
    try { await this.doSpawn(signal); if (this.state === 'spawning') this.setState('ready'); }
    catch (error) { this.fail(error); this.setState('error', `spawn failed: ${this.lastError}`); throw error; }
  }

  async reconnect(signal?: AbortSignal): Promise<void> {
    if (this.state === 'destroyed') throw new Error('body adapter was destroyed');
    this.setState('reconnecting');
    try { await this.doDestroy(); } catch (error) { this.fail(error); }
    try { await this.doSpawn(signal); if (this.state === 'reconnecting') this.setState('ready'); }
    catch (error) { this.fail(error); this.setState('error', `reconnect failed: ${this.lastError}`); throw error; }
  }

  async destroy(): Promise<void> {
    if (this.state === 'destroyed') return;
    try { await this.doDestroy(); } finally { this.setState('destroyed'); }
  }

  async act(action: BodyAction, signal?: AbortSignal): Promise<ActionReceipt> {
    const requestId = action.requestId ?? newRequestId();
    const verb = action.verb;
    this.counters.actions++; this.lastActionAt = this.now().toISOString();
    if (!REQUEST_ID.test(requestId)) return this.receipt(requestId, verb, 'rejected', 'requestId must match [A-Za-z0-9_-]{8,48}');
    const input = { verb, name: action.name, args: action.args === undefined ? {} : action.args };
    const original = this.requests.get(requestId);
    const prior = this.receipts.get(requestId);
    if ((original || prior) && !isDeepStrictEqual(original?.action, input))
      return this.receipt(requestId, verb, 'rejected', 'request_id_conflict; query the original request');
    if (original?.dispatching || prior) return this.result(requestId, signal);
    if (!(ACTION_VERBS as readonly string[]).includes(verb)) return this.receipt(requestId, verb, 'unsupported', `unknown verb ${String(verb)}`);
    if (typeof input.args !== 'object' || input.args === null || Array.isArray(input.args))
      return this.receipt(requestId, verb, 'rejected', 'args must be an object');
    let request;
    try { request = { action: structuredClone(input), dispatching: false }; }
    catch { return this.receipt(requestId, verb, 'rejected', 'args must contain transportable values'); }
    this.requests.set(requestId, request);
    if (!this.connected()) return this.record(this.receipt(requestId, verb, 'rejected', `body is ${this.lifecycle()}; spawn/reconnect first`));
    const caps = this.capabilities();
    if (verb !== 'native' && !caps.actions[verb])
      return this.record(this.receipt(requestId, verb, 'unsupported', `${this.kind} body does not support "${verb}"; supported: ${Object.keys(caps.actions).join(', ')}`));
    if (verb === 'native' && (!action.name || !caps.nativeActions.some(n => n.name === action.name)))
      return this.record(this.receipt(requestId, verb, 'unsupported', `unknown native action "${String(action.name)}" for ${this.kind}`));
    // Reserve this ID before a transport callback or another caller can enter act().
    request.dispatching = true;
    try {
      const receipt = await this.doAct({ ...structuredClone(request.action), requestId }, signal);
      return this.record(receipt.requestId === requestId ? receipt :
        this.receipt(requestId, verb, 'unknown', 'response requestId mismatch; query the original request'));
    } catch (error) {
      this.fail(error);
      // The request may or may not have reached the body: report unknown, never retry.
      return this.record(this.receipt(requestId, verb, error instanceof ArgumentError ? 'rejected' : 'unknown', this.lastError ?? 'error'));
    } finally {
      request.dispatching = false;
      this.trimReceipts();
    }
  }

  async result(requestId: string, signal?: AbortSignal): Promise<ActionReceipt> {
    const request = this.requests.get(requestId);
    const known = this.receipts.get(requestId);
    if (known?.terminal && known.status !== 'unknown') return known;
    if (request?.dispatching)
      return this.receipt(requestId, request.action.verb, 'unknown', 'dispatch in progress; query the original request', { terminal: false });
    const fresh = await this.doResult(requestId, signal).catch(error => { this.fail(error); return null; });
    const latest = this.receipts.get(requestId);
    if (latest?.terminal && latest.status !== 'unknown') return latest;
    if (fresh?.requestId === requestId) {
      if (latest || fresh.status !== 'unknown') this.remember(fresh);
      if (latest && fresh.terminal && fresh.status !== 'unknown') this.settled(fresh);
      return fresh;
    }
    return latest ?? this.receipt(requestId, 'native', 'unknown', 'no record of this request');
  }

  async stop(reason = 'stop requested'): Promise<ActionReceipt> {
    if (!this.connected()) return this.receipt(newRequestId('stop'), 'stop', 'rejected', `body is ${this.lifecycle()}`);
    try { return await this.doStop(reason); }
    catch (error) { this.fail(error); return this.receipt(newRequestId('stop'), 'stop', 'unknown', `stop not confirmed: ${this.lastError}`); }
  }

  subscribe(listener: (event: BodyEvent) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  health(): BodyHealth {
    return { kind: this.kind, lifecycle: this.lifecycle(), connected: this.connected(), since: this.startedAt, lastEventAt: this.lastEventAt,
      lastActionAt: this.lastActionAt, counters: { ...this.counters }, lastError: this.lastError, ...this.healthExtra() };
  }
  protected healthExtra(): Partial<BodyHealth> { return {}; }

  /** Emit a normalized event to subscribers (isolated: a throwing listener never breaks the body). */
  protected emit(draft: EventDraft): BodyEvent {
    const event: BodyEvent = { ...draft, at: draft.at ?? this.now().toISOString(), bodyKind: this.kind, bodyId: this.identity()?.bodyId ?? null,
      severity: draft.severity ?? SEVERITY[draft.kind] ?? 1, data: draft.data ?? {} };
    this.counters.events++; this.lastEventAt = event.at;
    for (const l of this.listeners) { try { l(event); } catch { /* isolated */ } }
    return event;
  }

  protected receipt(requestId: string, verb: ActionVerb, status: ActionStatus, text: string, extra: Partial<ActionReceipt> = {}): ActionReceipt {
    return { requestId, verb, status, terminal: status !== 'accepted', text: text.slice(0, 2000), retryAllowed: false, ...extra };
  }

  private remember(r: ActionReceipt): void {
    this.receipts.set(r.requestId, r);
    this.trimReceipts();
  }

  private trimReceipts(): void {
    if (this.receipts.size <= 500) return;
    for (const id of this.receipts.keys()) {
      if (this.requests.get(id)?.dispatching) continue;
      this.receipts.delete(id);
      this.requests.delete(id);
      if (this.receipts.size <= 500) break;
    }
  }

  protected record(r: ActionReceipt): ActionReceipt {
    // A native completion event may have arrived before the dispatch returned.
    const latest = this.receipts.get(r.requestId);
    if (latest?.terminal && latest.status !== 'unknown') return latest;
    this.remember(r);
    const c = this.counters;
    if (r.status === 'completed') c.completed++; else if (r.status === 'accepted') c.accepted++; else if (r.status === 'unknown') c.unknown++;
    else if (r.status === 'unsupported') c.unsupported++; else if (r.status === 'blocked_by_safety') c.safetyBlocked++; else c.failed++;
    return r;
  }

  /** Mark an accepted request terminal and publish `action_result` (used by bodies whose results arrive later). */
  protected settle(requestId: string, status: Exclude<ActionStatus, 'accepted'>, text: string, data?: unknown, raw?: unknown): ActionReceipt | null {
    const prior = this.receipts.get(requestId);
    if (prior?.terminal && (prior.status !== 'unknown' || status === 'unknown')) return null;
    const verb = prior?.verb ?? this.requests.get(requestId)?.action.verb ?? 'native';
    const r = this.receipt(requestId, verb, status, text, { executionId: prior?.executionId ?? requestId, ...(data !== undefined ? { data } : {}) });
    this.remember(r);
    if (status === 'completed') this.counters.completed++; else if (status === 'unknown') this.counters.unknown++; else this.counters.failed++;
    this.settled(r, raw);
    return r;
  }
  private settled(r: ActionReceipt, raw?: unknown): void {
    const phase = r.status === 'completed' ? 'completed' : r.status === 'unknown' ? 'unknown' : r.status === 'failed' ? 'blocked' : r.status;
    this.emit({ kind: 'action_result', text: `${r.verb} ${r.requestId} ${r.status}: ${r.text}`.slice(0, 500), severity: r.status === 'completed' ? 2 : 3,
      data: { requestId: r.requestId, verb: r.verb, status: r.status }, execution: { kind: 'task', id: r.executionId ?? r.requestId, phase, terminal: true }, raw });
  }

  protected fail(error: unknown): void {
    this.counters.errors++;
    this.lastError = String((error as Error)?.message ?? error).slice(0, 300);
  }
}

/** Thrown for invalid arguments before anything was sent to the body (safe: status `rejected`, not `unknown`). */
export class ArgumentError extends Error {}

export const num = (v: unknown, name: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ArgumentError(`${name} must be a finite number`);
  return v;
};
export const str = (v: unknown, name: string, max = 256): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new ArgumentError(`${name} must be a non-empty string (≤${max})`);
  return v;
};
export const optStr = (v: unknown, name: string, max = 256): string | undefined => v === undefined ? undefined : str(v, name, max);
export const optInt = (v: unknown, name: string, min: number, max: number): number | undefined => {
  if (v === undefined) return undefined;
  if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) throw new ArgumentError(`${name} must be an integer ${min}..${max}`);
  return v as number;
};
/** Accepts {x,y,z} or {at:[x,y,z]}. */
export const xyz = (args: Record<string, unknown>, name = 'target'): { x: number; y: number; z: number } => {
  if (Array.isArray(args.at) && args.at.length === 3) return { x: num(args.at[0], `${name}.x`), y: num(args.at[1], `${name}.y`), z: num(args.at[2], `${name}.z`) };
  return { x: num(args.x, `${name}.x`), y: num(args.y, `${name}.y`), z: num(args.z, `${name}.z`) };
};
export const hasXyz = (args: Record<string, unknown>) => (Array.isArray(args.at) && args.at.length === 3) || (args.x !== undefined && args.y !== undefined && args.z !== undefined);
export const only = (args: Record<string, unknown>, allowed: string[], verb: string) => {
  const extra = Object.keys(args).filter(k => !allowed.includes(k));
  if (extra.length) throw new ArgumentError(`${verb}: unsupported argument(s) ${extra.join(', ')}; allowed: ${allowed.join(', ') || '(none)'}`);
};
