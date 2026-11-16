/**
 * Safety hooks shared by every body:
 *  - anti-cheat / automation warning stop: server system lines are matched with agent-mc-world's own `isMiningWarningText`
 *    (same keywords/pattern/confirm rules as core/mining-limiter.ts). On a hit the body is stopped and motion verbs are refused
 *    (for the whole session by default, like agent-mc-world `hardStopOnWarning`).
 *  - pace limits: token buckets per action category (gateway TokenBucket), plus custom `beforeAction` hooks.
 * Implemented as a decorator so the raw adapters stay thin and the harness always talks to a guarded body.
 */
import { isMiningWarningText, MINING_LIMIT_DEFAULTS, type MiningLimits } from '../../../agent-mc-world/core/mining-limiter.ts';
import { TokenBucket } from '../gateway/limits.ts';
import type { ActionReceipt, ActionVerb, BodyAction, BodyAdapter, BodyCapabilities, BodyEvent, BodyHealth, BodyIdentity, BodyLifecycleState,
  BodySnapshot, PaceCategory } from './types.ts';
import { MOTION_VERBS } from './types.ts';

export interface PaceLimit { perMinute: number; burst: number }
export interface SafetyOptions {
  /** Warning matcher config (defaults = agent-mc-world MINING_LIMIT_DEFAULTS keywords/pattern/confirm). */
  warning?: Partial<Pick<MiningLimits, 'warningKeywords' | 'warningPattern' | 'warningConfirmPattern'>>;
  /** true (default): motion stays halted until `clearHalt()`; a number: halt for that many ms. */
  haltOnWarning?: true | number;
  pace?: Partial<Record<PaceCategory, PaceLimit>>;
  /** Extra veto hook (return a reason string to refuse). */
  beforeAction?: (action: BodyAction, body: BodyAdapter) => string | null | undefined;
  now?: () => number;
}

export const DEFAULT_PACE: Record<PaceCategory, PaceLimit> = {
  motion: { perMinute: 30, burst: 6 }, dig: { perMinute: 40, burst: 8 }, combat: { perMinute: 40, burst: 8 },
  chat: { perMinute: 12, burst: 3 }, other: { perMinute: 120, burst: 20 },
};

export function paceCategory(verb: ActionVerb): PaceCategory {
  if (verb === 'mine' || verb === 'collect' || verb === 'place') return 'dig';
  if (verb === 'attack' || verb === 'cast') return 'combat';
  if (verb === 'chat' || verb === 'command') return 'chat';
  if (MOTION_VERBS.includes(verb)) return 'motion';
  return 'other';
}

/** Kinds that carry server-originated text (never player chat). */
const SERVER_TEXT = new Set(['system_message', 'server_status']);

export class GuardedBody implements BodyAdapter {
  readonly kind: BodyAdapter['kind'];
  private halted: { reason: string; since: number; until: number } | null = null;
  private readonly buckets = new Map<PaceCategory, TokenBucket>();
  private readonly listeners = new Set<(e: BodyEvent) => void>();
  private readonly limits: MiningLimits;
  private readonly now: () => number;
  private blocked = 0;
  private readonly off: () => void;

  constructor(readonly inner: BodyAdapter, private readonly options: SafetyOptions = {}) {
    this.kind = inner.kind;
    this.now = options.now ?? Date.now;
    this.limits = { ...MINING_LIMIT_DEFAULTS, ...options.warning };
    const pace = { ...DEFAULT_PACE, ...options.pace };
    for (const [k, v] of Object.entries(pace) as Array<[PaceCategory, PaceLimit]>) this.buckets.set(k, new TokenBucket(v.perMinute, v.burst, this.now));
    this.off = inner.subscribe(e => this.onEvent(e));
  }

  private onEvent(e: BodyEvent): void {
    this.forward(e);
    if (!SERVER_TEXT.has(e.kind) || !isMiningWarningText(e.text, this.limits)) return;
    void this.trip(`server anti-cheat/automation warning: ${e.text.slice(0, 160)}`, e);
  }
  private forward(e: BodyEvent) { for (const l of this.listeners) { try { l(e); } catch { /* isolated */ } } }

  /** Halt motion and stop the body (also callable by a host/operator). */
  async trip(reason: string, cause?: BodyEvent): Promise<void> {
    const t = this.now(), hold = this.options.haltOnWarning ?? true;
    this.halted = { reason, since: t, until: hold === true ? Infinity : t + hold };
    this.forward({ kind: 'safety', at: new Date(t).toISOString(), bodyKind: this.kind, bodyId: this.inner.identity()?.bodyId ?? null, severity: 3,
      text: `安全停止：${reason}。移动/挖掘/战斗已暂停${hold === true ? '（本次会话）' : `（${Math.round(hold / 1000)} 秒）`}。`,
      data: { halted: true, reason, until: hold === true ? null : new Date(t + hold).toISOString(), cause: cause ? { kind: cause.kind, text: cause.text.slice(0, 200) } : null } });
    try { if (this.inner.capabilities().actions.stop) await this.inner.stop(reason); } catch { /* best effort */ }
  }
  /** Feed server text seen on another connection (e.g. the owner's login for maid/mcbot bodies). Returns true on a warning. */
  feedServerText(text: string): boolean {
    if (!isMiningWarningText(text, this.limits)) return false;
    void this.trip(`server anti-cheat/automation warning: ${text.slice(0, 160)}`);
    return true;
  }
  clearHalt(): void { this.halted = null; }
  haltState() { const h = this.halted && this.halted.until > this.now() ? this.halted : null; return h; }

  async act(action: BodyAction, signal?: AbortSignal): Promise<ActionReceipt> {
    const refuse = (text: string, retryAfterMs?: number): ActionReceipt => {
      this.blocked++;
      return { requestId: action.requestId ?? 'refused', verb: action.verb, status: 'blocked_by_safety', terminal: true, text, retryAllowed: false, ...(retryAfterMs ? { retryAfterMs } : {}) };
    };
    const native = action.verb === 'native' ? this.inner.capabilities().nativeActions.find(n => n.name === action.name) : null;
    const motion = MOTION_VERBS.includes(action.verb) || (action.verb === 'native' && native && !native.readOnly);
    const h = this.haltState();
    if (h && motion) return refuse(`safety halt active: ${h.reason}`);
    const veto = this.options.beforeAction?.(action, this.inner);
    if (veto) return refuse(veto);
    if (action.verb !== 'stop' && action.verb !== 'observe' && action.verb !== 'inventory') {
      const cat = action.verb === 'native' ? (native?.readOnly ? 'other' : 'motion') : paceCategory(action.verb);
      const t = this.buckets.get(cat)!.take();
      if (!t.ok) return refuse(`pace limit (${cat}): wait ${Math.ceil(t.retryAfterMs / 1000)}s`, t.retryAfterMs);
    }
    return this.inner.act(action, signal);
  }

  capabilities(): BodyCapabilities {
    const c = this.inner.capabilities();
    return { ...c, safety: { ...c.safety, antiCheatStop: true, paceLimits: true } };
  }
  health(): BodyHealth {
    const h = this.inner.health(), s = this.haltState();
    return { ...h, counters: { ...h.counters, safetyBlocked: h.counters.safetyBlocked + this.blocked },
      safety: { halted: !!s, reason: s?.reason ?? null, since: s ? new Date(s.since).toISOString() : null } };
  }
  subscribe(listener: (e: BodyEvent) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  identity(): BodyIdentity | null { return this.inner.identity(); }
  lifecycle(): BodyLifecycleState { return this.inner.lifecycle(); }
  spawn(signal?: AbortSignal) { return this.inner.spawn(signal); }
  reconnect(signal?: AbortSignal) { return this.inner.reconnect(signal); }
  async destroy() { this.off(); await this.inner.destroy(); }
  result(requestId: string, signal?: AbortSignal) { return this.inner.result(requestId, signal); }
  stop(reason?: string) { return this.inner.stop(reason); }
  snapshot(signal?: AbortSignal): Promise<BodySnapshot> { return this.inner.snapshot(signal); }
}

export const guardBody = (body: BodyAdapter, options?: SafetyOptions) => body instanceof GuardedBody ? body : new GuardedBody(body, options);
