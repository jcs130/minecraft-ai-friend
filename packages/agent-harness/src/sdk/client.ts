/**
 * Minimal client SDK for the harness message gateway. Dependency-free: uses the platform WebSocket (Node ≥22, browsers)
 * and fetch. Third-party agents talk only messages — they never call body tools.
 *
 *   const c = new HarnessGatewayClient({ url: 'http://127.0.0.1:8787', token: process.env.HARNESS_TOKEN });
 *   await c.connect();
 *   await c.subscribe(e => console.log(e.text), { minSeverity: 2 });
 *   const { intentId } = await c.submitIntent({ goal: '钓鱼', constraints: { steps: [{ tool: 'mc_do', args: { steps: [{ skill: 'fish' }] } }] } });
 */
import type { HarnessEvent, HarnessEventKind, Intent, IntentState, PriorityInput, Summary } from '../types.ts';
import type { ConstraintsPayload, ErrorCode, ErrorPayload, Payloads, RequestType, ResponseEnvelope } from '../gateway/protocol.ts';

export interface Welcome {
  protocol: string; v: number; session: string; agent: string; admin: boolean; anonymous: boolean; stream: string; latest: number;
  limits: Record<string, number>; server: { name: string; execute: boolean; exclusiveBody: boolean };
}
export interface PullResult { events: HarnessEvent[]; cursor: number; latest: number; stream: string; streamReset: boolean; dropped: boolean; hasMore: boolean }
export interface EventFilter { minSeverity?: 1 | 2 | 3; kinds?: HarnessEventKind[] }

export class GatewayRequestError extends Error {
  readonly code: ErrorCode; readonly retryAfterMs?: number;
  constructor(p: ErrorPayload) { super(`${p.code}: ${p.message}`); this.code = p.code; this.retryAfterMs = p.retryAfterMs; }
}

export interface GatewayClientOptions {
  /** Base URL, e.g. http://127.0.0.1:8787 */
  url: string;
  /** Agent token (keep it in an env var; never log it). Omit only for anonymous loopback servers. */
  token?: string;
  /** 'ws' (default): push + requests over one socket. 'http': requests via POST, subscriptions by polling pull_events. */
  transport?: 'ws' | 'http';
  requestTimeoutMs?: number;
  /** Auto-reconnect (ws) with resume from the last seen event. Default true. */
  reconnect?: boolean;
  pollIntervalMs?: number;
  clientName?: string;
  onStatus?: (status: 'connected' | 'disconnected' | 'reconnecting' | 'closed', detail?: string) => void;
  WebSocket?: typeof WebSocket;
  fetch?: typeof fetch;
}

interface LocalSub { localId: string; serverId: string | null; filter: EventFilter; listener: (e: HarnessEvent, meta: { gap: boolean }) => void;
  cursor: number; stream: string | null; poll?: ReturnType<typeof setTimeout> }

export class HarnessGatewayClient {
  private ws: WebSocket | null = null;
  private seq = 0;
  private readonly pending = new Map<string, { resolve: (e: ResponseEnvelope) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly subs = new Map<string, LocalSub>();
  private closed = false;
  private backoff = 250;
  welcome: Welcome | null = null;

  constructor(private readonly options: GatewayClientOptions) {}

  private get transport() { return this.options.transport ?? 'ws'; }
  private nextId() { return `c-${Date.now().toString(36)}-${++this.seq}`; }

  async connect(): Promise<Welcome> {
    this.closed = false;
    if (this.transport === 'http') {
      this.welcome = await this.request<Welcome>('hello', { ...(this.options.token ? { token: this.options.token } : {}), protocols: [1],
        client: { name: this.options.clientName ?? 'agent-mc-harness-sdk', version: '1' } });
      return this.welcome;
    }
    await this.openSocket();
    return this.welcome!;
  }

  private async openSocket(): Promise<void> {
    const WS = this.options.WebSocket ?? globalThis.WebSocket;
    if (!WS) throw new Error('No WebSocket implementation; use transport: "http" or pass options.WebSocket');
    const url = this.options.url.replace(/^http/, 'ws').replace(/\/$/, '') + '/v1/ws';
    const ws = new WS(url);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error(`cannot connect to ${url}`));
    });
    this.ws = ws;
    ws.onmessage = ev => this.onMessage(String(ev.data));
    ws.onclose = ev => this.onClose(ev.code, ev.reason);
    ws.onerror = () => { /* close follows */ };
    this.welcome = await this.request<Welcome>('hello', { ...(this.options.token ? { token: this.options.token } : {}), protocols: [1],
      client: { name: this.options.clientName ?? 'agent-mc-harness-sdk', version: '1' } });
    this.backoff = 250;
    this.options.onStatus?.('connected');
    // Resume subscriptions from the last seen event.
    for (const sub of this.subs.values()) await this.serverSubscribe(sub);
  }

  private onMessage(text: string) {
    let msg: ResponseEnvelope;
    try { msg = JSON.parse(text); } catch { return; }
    if (msg.type === 'event') {
      const p = msg.payload as { subscription: string; stream: string; event: HarnessEvent; gap?: boolean };
      const sub = [...this.subs.values()].find(s => s.serverId === p.subscription);
      // Replayed events can arrive before the subscribe response continuation ran: park them briefly.
      if (!sub) { if (this.orphans.length < 1000) this.orphans.push(p); return; }
      this.deliver(sub, p);
      return;
    }
    if (msg.re) {
      const w = this.pending.get(msg.re);
      if (w) { this.pending.delete(msg.re); clearTimeout(w.timer); w.resolve(msg); }
    }
  }

  private orphans: Array<{ subscription: string; stream: string; event: HarnessEvent; gap?: boolean }> = [];
  private deliver(sub: LocalSub, p: { stream: string; event: HarnessEvent; gap?: boolean }) {
    if (p.event.seq <= sub.cursor && p.stream === sub.stream) return;
    sub.cursor = p.event.seq; sub.stream = p.stream;
    try { sub.listener(p.event, { gap: !!p.gap }); } catch { /* listener errors stay local */ }
  }

  private onClose(code: number, reason: string) {
    this.ws = null;
    for (const [id, w] of this.pending) { clearTimeout(w.timer); w.reject(new GatewayRequestError({ code: 'unavailable', message: `connection closed (${code})` })); this.pending.delete(id); }
    for (const sub of this.subs.values()) sub.serverId = null;
    this.orphans = [];
    if (this.closed) { this.options.onStatus?.('closed'); return; }
    this.options.onStatus?.('disconnected', `${code} ${reason}`);
    if (this.options.reconnect === false || code === 1008) return;
    const delay = this.backoff; this.backoff = Math.min(this.backoff * 2, 10_000);
    setTimeout(() => {
      if (this.closed) return;
      this.options.onStatus?.('reconnecting');
      this.openSocket().catch(() => this.onClose(1006, 'reconnect failed'));
    }, delay);
  }

  /** Send one request and await its correlated response. Rejects with GatewayRequestError on `error`. */
  async request<T = unknown>(type: RequestType, payload: object = {}): Promise<T> {
    const id = this.nextId();
    const message = { v: 1, id, type, ts: new Date().toISOString(), payload };
    let res: ResponseEnvelope;
    if (this.transport === 'http') {
      const f = this.options.fetch ?? fetch;
      const r = await f(this.options.url.replace(/\/$/, '') + '/v1/messages', { method: 'POST',
        headers: { 'content-type': 'application/json', ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : {}) },
        body: JSON.stringify(message), signal: AbortSignal.timeout(this.options.requestTimeoutMs ?? 15_000) });
      res = await r.json() as ResponseEnvelope;
    } else {
      const ws = this.ws;
      if (!ws || ws.readyState !== ws.OPEN) throw new GatewayRequestError({ code: 'unavailable', message: 'not connected' });
      res = await new Promise<ResponseEnvelope>((resolve, reject) => {
        const timer = setTimeout(() => { this.pending.delete(id); reject(new GatewayRequestError({ code: 'unavailable', message: 'request timed out' })); },
          this.options.requestTimeoutMs ?? 15_000);
        this.pending.set(id, { resolve, reject, timer });
        ws.send(JSON.stringify(message));
      });
    }
    if (res.type === 'error') throw new GatewayRequestError(res.payload as ErrorPayload);
    return res.payload as T;
  }

  // ---- typed helpers ----
  submitIntent(input: { goal: string; priority?: PriorityInput; constraints?: ConstraintsPayload; hostRef?: string }) {
    return this.request<{ intentId: string; state: IntentState }>('submit_intent', input);
  }
  updateIntent(intentId: string, patch: Omit<Payloads['update_intent'], 'intentId'>) {
    return this.request<{ intent: Intent }>('update_intent', { intentId, ...patch }).then(r => r.intent);
  }
  getIntent(intentId: string) { return this.request<{ intent: Intent }>('control', { action: 'get', intentId }).then(r => r.intent); }
  listIntents(options: { states?: IntentState[]; limit?: number } = {}) { return this.request<{ intents: Intent[] }>('control', { action: 'list', ...options }).then(r => r.intents); }
  pause(intentId?: string, reason?: string) { return this.request<{ intent?: Intent }>('control', { action: 'pause', ...(intentId ? { intentId } : {}), ...(reason ? { reason } : {}) }); }
  resume(intentId?: string) { return this.request<{ intent?: Intent }>('control', { action: 'resume', ...(intentId ? { intentId } : {}) }); }
  cancel(intentId: string, reason?: string) { return this.request<{ intent: Intent }>('control', { action: 'cancel', intentId, ...(reason ? { reason } : {}) }).then(r => r.intent); }
  getSummary(options: { topic?: string; maxTokens?: number } = {}) { return this.request<{ summary: Summary }>('get_summary', options).then(r => r.summary); }
  /** Body kind, lifecycle, identity and (by default) capabilities + health; add 'snapshot' for a fresh observation. */
  getBody(include?: Array<'capabilities' | 'health' | 'snapshot'>) {
    return this.request<{ body: Record<string, unknown> | null }>('get_body', include ? { include } : {}).then(r => r.body);
  }
  pullEvents(options: Payloads['pull_events'] = {}) { return this.request<PullResult>('pull_events', options); }
  ping() { return this.request<{ nonce: string | null; latest: number }>('ping', {}); }

  /**
   * Subscribe to key events. Over ws the server pushes; over http the SDK polls pull_events. Either way the SDK keeps a cursor
   * and resumes after reconnects (`after` + `stream`), so events are delivered at most once and gaps are reported.
   */
  async subscribe(listener: (e: HarnessEvent, meta: { gap: boolean }) => void, filter: EventFilter & { after?: number } = {}) {
    const sub: LocalSub = { localId: `l${++this.seq}`, serverId: null, filter: { minSeverity: filter.minSeverity, kinds: filter.kinds },
      listener, cursor: filter.after ?? this.welcome?.latest ?? 0, stream: this.welcome?.stream ?? null };
    this.subs.set(sub.localId, sub);
    if (this.transport === 'http') this.poll(sub); else await this.serverSubscribe(sub);
    return { id: sub.localId, cursor: () => sub.cursor, close: () => this.unsubscribe(sub.localId) };
  }

  private async serverSubscribe(sub: LocalSub) {
    const r = await this.request<{ subscription: string; stream: string }>('subscribe', { ...sub.filter.minSeverity ? { minSeverity: sub.filter.minSeverity } : {},
      ...(sub.filter.kinds ? { kinds: sub.filter.kinds } : {}), after: sub.cursor, ...(sub.stream ? { stream: sub.stream } : {}) });
    if (sub.stream !== r.stream) sub.cursor = 0;
    sub.serverId = r.subscription; sub.stream = r.stream;
    const mine = this.orphans.filter(o => o.subscription === r.subscription);
    this.orphans = this.orphans.filter(o => o.subscription !== r.subscription);
    for (const o of mine) this.deliver(sub, o);
  }

  private poll(sub: LocalSub) {
    const tick = async () => {
      if (this.closed || !this.subs.has(sub.localId)) return;
      try {
        const r = await this.pullEvents({ after: sub.cursor, limit: 100, ...(sub.filter.minSeverity ? { minSeverity: sub.filter.minSeverity } : {}),
          ...(sub.filter.kinds ? { kinds: sub.filter.kinds } : {}), ...(sub.stream ? { stream: sub.stream } : {}) });
        let gap = r.dropped || r.streamReset;
        for (const e of r.events) { try { sub.listener(e, { gap }); } catch { /* local */ } gap = false; }
        sub.cursor = r.cursor; sub.stream = r.stream;
        if (r.hasMore) { sub.poll = setTimeout(tick, 0); return; }
      } catch { /* retry next tick */ }
      sub.poll = setTimeout(tick, this.options.pollIntervalMs ?? 1000);
    };
    sub.poll = setTimeout(tick, 0);
  }

  async unsubscribe(localId: string) {
    const sub = this.subs.get(localId); if (!sub) return;
    this.subs.delete(localId);
    if (sub.poll) clearTimeout(sub.poll);
    if (sub.serverId && this.ws) await this.request('unsubscribe', { subscription: sub.serverId }).catch(() => {});
  }

  async close() {
    this.closed = true;
    for (const sub of this.subs.values()) if (sub.poll) clearTimeout(sub.poll);
    this.subs.clear();
    const ws = this.ws;
    if (ws) await new Promise<void>(resolve => { ws.addEventListener('close', () => resolve(), { once: true }); ws.close(1000, 'bye'); });
    else this.options.onStatus?.('closed');
  }
}
