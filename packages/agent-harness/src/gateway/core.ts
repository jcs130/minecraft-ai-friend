import { randomUUID } from 'node:crypto';
import type { HarnessRuntime } from '../harness.ts';
import { normalizePriority } from '../intents.ts';
import { BODY_TOOL_ALLOWLIST } from '../planner.ts';
import { TERMINAL_STATES, type HarnessEvent, type HarnessEventKind, type Intent, type IntentState } from '../types.ts';
import type { AgentRegistry, GatewayAgent } from './auth.ts';
import { RateLimiter, type GatewayLimits } from './limits.ts';
import { GATEWAY_PROTOCOL, GATEWAY_VERSION, GatewayError, parseRequest, requestIdOf, type ConstraintsPayload, type ErrorPayload,
  type EventPush, type Payloads, type RequestEnvelope, type ResponseEnvelope, type ResponseType } from './protocol.ts';

export type Transport = 'ws' | 'http' | 'sse';

interface Subscription {
  id: string; minSeverity: 1 | 2 | 3; kinds: Set<HarnessEventKind> | null; lastSeq: number; gap: boolean; off: () => void;
}

export interface GatewaySession {
  readonly id: string;
  readonly transport: Transport;
  readonly remote: string;
  agent: GatewayAgent | null;
  readonly subscriptions: Map<string, Subscription>;
  /** Deliver a push; return false when it had to be dropped (backpressure). Absent for plain HTTP. */
  push?: (message: ResponseEnvelope<EventPush>) => boolean;
  closed: boolean;
}

export interface HandleResult {
  response: ResponseEnvelope;
  /** Run right after the response was written (subscription replay + live registration). */
  after?: () => void;
  /** Transport should close the connection after sending (e.g. auth failure). */
  close?: boolean;
}

export interface GatewayInfo { execute: boolean; exclusive: boolean }
type Log = (message: string, data?: Record<string, unknown>) => void;

/**
 * Transport-independent gateway logic: authentication, ownership, rate limits, validation and dispatch to the harness.
 * Token values are never logged or echoed.
 */
export class GatewayCore {
  private readonly limiter: RateLimiter;
  private readonly connections = new Map<string, number>();
  private readonly sessions = new Set<GatewaySession>();
  private seq = 0;

  constructor(readonly harness: HarnessRuntime, readonly registry: AgentRegistry, readonly limits: GatewayLimits,
    readonly info: GatewayInfo = { execute: false, exclusive: false }, private readonly log: Log = () => {}, private readonly clock: () => number = Date.now) {
    this.limiter = new RateLimiter(clock);
  }

  openSession(transport: Transport, remote: string, push?: GatewaySession['push']): GatewaySession {
    const s: GatewaySession = { id: `ses_${randomUUID()}`, transport, remote, agent: null, subscriptions: new Map(), push, closed: false };
    this.sessions.add(s);
    return s;
  }

  closeSession(s: GatewaySession): void {
    if (s.closed) return;
    s.closed = true;
    for (const sub of s.subscriptions.values()) sub.off();
    s.subscriptions.clear();
    if (s.agent && s.transport !== 'http') this.connections.set(s.agent.id, Math.max(0, (this.connections.get(s.agent.id) ?? 1) - 1));
    this.sessions.delete(s);
  }

  /** Authenticate a session from a transport credential (HTTP/WS `Authorization: Bearer`). Null credential → anonymous if allowed. */
  authenticate(s: GatewaySession, token: string | null): GatewayAgent {
    const blocked = this.authBlocked(s.remote);
    if (blocked) throw blocked;
    const agent = this.registry.authenticate(token);
    if (!agent) {
      this.recordFailure(s.remote);
      this.log('gateway auth rejected', { remote: s.remote, transport: s.transport, credential: token ? 'invalid' : 'missing' });
      throw new GatewayError('unauthorized', token ? 'invalid token' : 'token required');
    }
    if (s.agent) {
      if (s.agent.id !== agent.id) throw new GatewayError('forbidden', `session is already authenticated as ${s.agent.id}`);
      return agent;
    }
    if (s.transport !== 'http') {
      const n = this.connections.get(agent.id) ?? 0;
      if (n >= this.limits.maxConnectionsPerAgent) throw new GatewayError('quota_exceeded', 'too many connections for this agent');
      this.connections.set(agent.id, n + 1);
    }
    s.agent = agent;
    if (s.transport !== 'http') this.log('gateway session authenticated', { session: s.id, agent: agent.id, transport: s.transport, remote: s.remote });
    return agent;
  }

  /** Sliding one-minute window of failed authentications per remote address. */
  private readonly failureLedger = new Map<string, number[]>();
  private authBlocked(remote: string): GatewayError | null {
    const now = this.clock();
    const times = (this.failureLedger.get(remote) ?? []).filter(t => now - t < 60_000);
    if (times.length) this.failureLedger.set(remote, times); else this.failureLedger.delete(remote);
    if (times.length < this.limits.authFailuresPerMinute) return null;
    return new GatewayError('rate_limited', 'too many failed authentication attempts', { retryAfterMs: 60_000 - (now - times[0]!) });
  }
  private recordFailure(remote: string): void {
    const times = this.failureLedger.get(remote) ?? [];
    times.push(this.clock()); if (times.length > 100) times.shift();
    this.failureLedger.delete(remote); this.failureLedger.set(remote, times);
    if (this.failureLedger.size > 10_000) this.failureLedger.delete(this.failureLedger.keys().next().value!);
  }

  private envelope<P>(type: ResponseType, payload: P, re?: string): ResponseEnvelope<P> {
    return { v: GATEWAY_VERSION, id: `s-${++this.seq}`, ...(re ? { re } : {}), type, ts: new Date().toISOString(), payload };
  }
  errorResponse(error: unknown, re?: string): ResponseEnvelope<ErrorPayload> {
    const g = toGatewayError(error, this.log);
    return this.envelope('error', g.payload(), re);
  }

  /** Handle one inbound message. Never throws. `bytes` is the raw size (already bounded by the transport). */
  async handle(s: GatewaySession, raw: string, bytes = Buffer.byteLength(raw)): Promise<HandleResult> {
    const re = requestIdOf(raw);
    if (bytes > this.limits.maxMessageBytes)
      return { response: this.errorResponse(new GatewayError('too_large', `message exceeds ${this.limits.maxMessageBytes} bytes`), re) };
    let req: RequestEnvelope;
    try { req = parseRequest(raw); } catch (error) { return { response: this.errorResponse(error, re) }; }
    try {
      if (req.type === 'hello') return this.hello(s, req as RequestEnvelope<'hello'>);
      if (!s.agent) {
        // Transports without a header credential: anonymous loopback mode or explicit hello first.
        if (this.registry.anonymous) this.authenticate(s, null);
        else {
          const blocked = this.authBlocked(s.remote);
          if (blocked) throw blocked;
          this.recordFailure(s.remote);
          throw new GatewayError('unauthorized', 'send hello with a token first (or use Authorization: Bearer)');
        }
      }
      const agent = s.agent!;
      if (req.agent && req.agent !== agent.id) throw new GatewayError('forbidden', 'envelope agent does not match the authenticated agent');
      const rate = this.limiter.take(agent.id, agent.ratePerMinute, agent.burst);
      if (!rate.ok) throw new GatewayError('rate_limited', 'rate limit exceeded', { retryAfterMs: rate.retryAfterMs });
      return await this.dispatch(s, agent, req);
    } catch (error) {
      const g = toGatewayError(error, this.log);
      if (g.code === 'unauthorized' || g.code === 'forbidden' || g.code === 'rate_limited' || g.code === 'quota_exceeded')
        this.log('gateway request refused', { session: s.id, agent: s.agent?.id ?? null, type: req.type, code: g.code });
      return { response: this.envelope('error', g.payload(), req.id), close: s.transport === 'ws' && !s.agent && (g.code === 'unauthorized' || g.code === 'rate_limited' || g.code === 'quota_exceeded') };
    }
  }

  private hello(s: GatewaySession, req: RequestEnvelope<'hello'>): HandleResult {
    const p = req.payload;
    if (p.protocols && !p.protocols.includes(GATEWAY_VERSION))
      throw new GatewayError('unsupported_version', 'no common protocol version', { supported: [GATEWAY_VERSION] });
    const agent = s.agent && !p.token ? s.agent : this.authenticate(s, p.token ?? null);
    if (req.agent && req.agent !== agent.id) throw new GatewayError('forbidden', 'envelope agent does not match the token');
    return { response: this.envelope('welcome', {
      protocol: GATEWAY_PROTOCOL, v: GATEWAY_VERSION, session: s.id, agent: agent.id, admin: agent.admin, anonymous: agent.anonymous,
      stream: this.harness.events.streamId, latest: this.harness.events.latest(),
      limits: { maxMessageBytes: this.limits.maxMessageBytes, ratePerMinute: agent.ratePerMinute, burst: agent.burst,
        maxPriority: agent.maxPriority, maxOpenIntents: agent.maxOpenIntents, maxSubscriptions: this.limits.maxSubscriptionsPerSession },
      server: { name: 'agent-mc-harness', execute: this.info.execute, exclusiveBody: this.info.exclusive },
    }, req.id) };
  }

  private async dispatch(s: GatewaySession, agent: GatewayAgent, req: RequestEnvelope): Promise<HandleResult> {
    const ok = (payload: unknown, type: ResponseType = 'result'): HandleResult => ({ response: this.envelope(type, payload, req.id) });
    switch (req.type) {
      case 'ping': return ok({ nonce: (req.payload as Payloads['ping']).nonce ?? null, latest: this.harness.events.latest() }, 'pong');
      case 'submit_intent': {
        const p = req.payload as Payloads['submit_intent'];
        this.checkPriority(agent, p.priority); this.checkSteps(p.constraints);
        const open = this.harness.listIntents({ owner: agent.id, limit: 1000 }).filter(i => !TERMINAL_STATES.includes(i.state)).length;
        if (open >= agent.maxOpenIntents) throw new GatewayError('quota_exceeded', `open intent quota (${agent.maxOpenIntents}) reached`);
        const r = await this.harness.submitIntent({ goal: p.goal, priority: p.priority, constraints: p.constraints, hostRef: p.hostRef, owner: agent.id });
        return ok(r);
      }
      case 'update_intent': {
        const p = req.payload as Payloads['update_intent'];
        this.owned(agent, p.intentId); this.checkPriority(agent, p.priority); this.checkSteps(p.constraints);
        const intent = await this.harness.updateIntent(p.intentId, { goal: p.goal, priority: p.priority, constraints: p.constraints });
        return ok({ intent });
      }
      case 'control': {
        const p = req.payload as Payloads['control'];
        if (p.action === 'list') {
          const intents = this.harness.listIntents({ states: p.states as IntentState[] | undefined, limit: p.limit ?? 50,
            ...(agent.admin ? {} : { owner: agent.id }) });
          return ok({ intents });
        }
        if (!p.intentId) {
          if (!agent.admin) throw new GatewayError('forbidden', `${p.action} without intentId (whole harness) requires admin`);
          if (p.action === 'pause') await this.harness.pause(undefined, p.reason); else await this.harness.resume();
          return ok({ executor: p.action === 'pause' ? 'paused' : 'running' });
        }
        this.owned(agent, p.intentId);
        const intent = p.action === 'get' ? this.harness.getIntent(p.intentId)
          : p.action === 'pause' ? await this.harness.pause(p.intentId, p.reason ?? `paused by ${agent.id}`)
          : p.action === 'resume' ? await this.harness.resume(p.intentId)
          : await this.harness.cancel(p.intentId, p.reason ?? `cancelled by ${agent.id}`);
        return ok({ intent });
      }
      case 'get_summary': {
        const p = req.payload as Payloads['get_summary'];
        const summary = await this.harness.getSummary({ topic: p.topic, maxTokens: p.maxTokens, ...(agent.admin ? {} : { viewer: agent.id }) });
        return ok({ summary });
      }
      case 'pull_events': {
        const p = req.payload as Payloads['pull_events'];
        return ok(this.pull(agent, p));
      }
      case 'subscribe': return this.subscribe(s, agent, req as RequestEnvelope<'subscribe'>);
      case 'unsubscribe': {
        const id = (req.payload as Payloads['unsubscribe']).subscription;
        const sub = s.subscriptions.get(id);
        if (!sub) throw new GatewayError('not_found', `unknown subscription ${id}`);
        sub.off(); s.subscriptions.delete(id);
        return ok({ subscription: id, unsubscribed: true });
      }
      default: throw new GatewayError('unknown_type', `unsupported type ${req.type}`);
    }
  }

  // ---- policy helpers ----
  visible(agent: GatewayAgent, e: HarnessEvent): boolean {
    if (agent.admin || !e.intentId) return true;
    return this.harness.getIntent(e.intentId)?.owner === agent.id;
  }

  private owned(agent: GatewayAgent, intentId: string): Intent {
    const intent = this.harness.getIntent(intentId);
    if (!intent) throw new GatewayError('not_found', `unknown intent ${intentId}`);
    if (!agent.admin && intent.owner !== agent.id) throw new GatewayError('forbidden', 'intent belongs to another agent');
    return intent;
  }
  private checkPriority(agent: GatewayAgent, p: Payloads['submit_intent']['priority']): void {
    if (p === undefined) return;
    if (normalizePriority(p) > agent.maxPriority) throw new GatewayError('forbidden', `priority above this agent's maximum (${agent.maxPriority})`);
  }
  private checkSteps(c: ConstraintsPayload | undefined): void {
    for (const step of c?.steps ?? [])
      if (!BODY_TOOL_ALLOWLIST.test(step.tool)) throw new GatewayError('bad_request', `body tool ${step.tool} is not allowed in intent steps`);
  }

  private pull(agent: GatewayAgent, p: Payloads['pull_events']) {
    const hub = this.harness.events;
    const streamReset = p.stream !== undefined && p.stream !== hub.streamId;
    const after = streamReset ? 0 : p.after ?? 0;
    const limit = p.limit ?? 20, minSeverity = p.minSeverity ?? 1, kinds = p.kinds ? new Set(p.kinds) : null;
    const events: HarnessEvent[] = [];
    let cursor = after;
    for (const e of hub.since(after)) {
      if (events.length >= limit) break;
      cursor = e.seq;
      if (e.severity >= minSeverity && (!kinds || kinds.has(e.kind)) && this.visible(agent, e)) events.push(e);
    }
    const latest = hub.latest();
    if (events.length < limit) cursor = Math.max(cursor, latest);
    return { events, cursor, latest, stream: hub.streamId, streamReset, dropped: after < hub.oldest() - 1, hasMore: cursor < latest };
  }

  private subscribe(s: GatewaySession, agent: GatewayAgent, req: RequestEnvelope<'subscribe'>): HandleResult {
    if (!s.push) throw new GatewayError('bad_request', 'subscribe needs a push transport (WebSocket or SSE); use pull_events over HTTP');
    if (s.subscriptions.size >= this.limits.maxSubscriptionsPerSession) throw new GatewayError('quota_exceeded', 'too many subscriptions on this session');
    const p = req.payload;
    const hub = this.harness.events;
    const streamReset = p.stream !== undefined && p.stream !== hub.streamId;
    const replayFrom = streamReset ? 0 : p.after;
    const sub: Subscription = { id: `sub_${randomUUID().slice(0, 8)}`, minSeverity: p.minSeverity ?? 1, kinds: p.kinds ? new Set(p.kinds) : null,
      lastSeq: replayFrom ?? hub.latest(), gap: false, off: () => {} };
    s.subscriptions.set(sub.id, sub);
    const deliver = (e: HarnessEvent) => {
      if (s.closed || e.seq <= sub.lastSeq) return;
      sub.lastSeq = e.seq;
      if (e.severity < sub.minSeverity || (sub.kinds && !sub.kinds.has(e.kind)) || !this.visible(agent, e)) return;
      const delivered = s.push!(this.envelope<EventPush>('event', { subscription: sub.id, stream: hub.streamId, event: e, ...(sub.gap ? { gap: true } : {}) }));
      sub.gap = !delivered;
    };
    return {
      response: this.envelope('result', { subscription: sub.id, stream: hub.streamId, latest: hub.latest(), streamReset,
        replay: replayFrom !== undefined, dropped: replayFrom !== undefined && replayFrom < hub.oldest() - 1 }, req.id),
      after: () => {
        if (s.closed || !s.subscriptions.has(sub.id)) return;
        // Replays everything after the start cursor, including events emitted while the response was in flight.
        for (const e of hub.since(sub.lastSeq)) deliver(e);
        sub.off = hub.subscribe(deliver, 1);
      },
    };
  }

  /** Server-initiated subscription (SSE). */
  subscribeDirect(s: GatewaySession, payload: Payloads['subscribe']): HandleResult {
    return this.subscribe(s, s.agent!, { v: 1, id: `sse-${s.id}`, type: 'subscribe', payload });
  }

  stats() { return { sessions: this.sessions.size, connections: Object.fromEntries(this.connections) }; }
  closeAll(): void { for (const s of [...this.sessions]) this.closeSession(s); }
}

function toGatewayError(error: unknown, log: Log): GatewayError {
  if (error instanceof GatewayError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/^Unknown intent/.test(message)) return new GatewayError('not_found', message);
  if (/Invalid priority|goal is required/.test(message)) return new GatewayError('bad_request', message);
  if (/cannot go from|already active|not paused|Pause the active|is (done|cancelled|failed|queued|active|paused)\b/.test(message))
    return new GatewayError('conflict', message);
  log('gateway internal error', { error: message.slice(0, 300) });
  return new GatewayError('internal', 'internal error');
}
