import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EventEnvelope, Logger, ModelFacts, ToolOutcome, World, WorldHost } from './contracts.ts';
import { MinecraftClientWorld } from './world.ts';
import { assertMinecraftReady } from './config.ts';
import type { MinecraftClientConfig } from './config.ts';
import { renderTemplate } from '../../core/support/runtime.mjs';
import { AgentJournal } from './journal.ts';
import { AgentConnectionLease } from './connection-lease.ts';
import { AgentMetrics } from './metrics.ts';
import { createHash } from 'node:crypto';
import { PROTOCOL, type CallOptions, type ContextBudget, type ExecutionReceipt, type TurnReceipt } from '../contracts/protocol.ts';
import { CurrentFacts, prepareContext } from './context.ts';
import { RequestLedger } from './request-ledger.ts';

export interface MinecraftClientOptions {
  cfg: MinecraftClientConfig;
  dataDir: string;
  timezone?: string;
  agentName?: string;
  modelFacts?: ModelFacts;
  log: Logger;
}

export type ClientEnvironment = World & { requestFacts?(): unknown };

/** The caller owns reasoning, memory and wakeups. This runtime owns one game connection and its receipts. */
export class MinecraftAgentClient {
  readonly journal: AgentJournal;
  readonly metrics: AgentMetrics;
  private phase: 'disconnected' | 'starting' | 'started' | 'stopping' = 'disconnected';
  private transition?: Promise<void>;
  private startupPending = false;
  private readonly host: WorldHost;
  private lifetime = new AbortController();
  private epoch = 0;
  private round = 0;
  private turn: TurnReceipt | null = null;
  private barrier: string | null = null;
  private endRequested = false;
  private closingTurn = false;
  private readonly endedTurns = new Map<string, TurnReceipt>();
  private readonly requests: RequestLedger;
  private readonly calls = new Map<string, { signature: string; controller: AbortController; promise: Promise<ToolOutcome>; pending: boolean }>();
  private readonly executions = new Map<string, ExecutionReceipt>();
  private readonly facts: CurrentFacts;
  private readonly lease: AgentConnectionLease;

  constructor(protected readonly options: MinecraftClientOptions,
    private readonly world: ClientEnvironment = new MinecraftClientWorld({ cfg: options.cfg, dataDir: options.dataDir,
      timezone: options.timezone ?? 'UTC', botName: options.agentName ?? options.cfg.username }),
    readonly binding: { profile: string; toolPrefix: 'mc' | 'mymc' } = { profile: 'minecraft', toolPrefix: 'mc' }) {
    this.journal = new AgentJournal(options.dataDir, 1024, world.id);
    this.facts = new CurrentFacts(this.journal);
    this.requests = new RequestLedger(this.journal);
    this.metrics = new AgentMetrics(this.journal.run, options.dataDir, handle => this.journal.blob(handle) !== null);
    this.lease = new AgentConnectionLease(options.dataDir, this.journal.run);
    this.host = {
      pushEvent: async (event, opts) => {
        if (event.execution) this.executions.set(`${event.execution.kind}:${event.execution.id}`, event.execution);
        return this.journal.pushEvent(event, opts);
      },
      pushDeferred: (event, opts) => this.journal.pushDeferred(event, opts),
      drainPendingEvents: filter => this.journal.drainPendingEvents(filter),
      store: this.journal.store,
      blob: handle => this.journal.blob(handle),
      modelFacts: options.modelFacts ?? { model: () => '', accepts: () => false, contextWindow: () => undefined },
      reportUsage: (usage, metadata) => appendFileSync(join(options.dataDir, 'usage.jsonl'), JSON.stringify({
        at: new Date().toISOString(), run: this.journal.run, usage, metadata }) + '\n'),
      log: options.log,
    };
  }

  get profile() { return this.binding.profile; }
  get toolPrefix() { return this.binding.toolPrefix; }
  protected validateConfig(): void { assertMinecraftReady(this.options.cfg); }

  tools() { return this.world.tools(); }

  async connect(): Promise<void> {
    if (this.phase === 'started') return;
    if (this.phase === 'starting') return this.transition;
    if (this.phase === 'stopping') throw new Error('Game runtime is stopping.');
    if (this.startupPending) throw new Error('Previous engine startup is still draining');
    this.validateConfig();
    this.lease.acquire();
    const epoch = ++this.epoch;
    this.lifetime = new AbortController();
    this.phase = 'starting';
    this.transition = (async () => {
      try {
        this.startupPending = true;
        const startup = this.world.start({ ...this.host,
          pushEvent: (event, opts) => this.epoch === epoch ? this.host.pushEvent(event, opts)
            : this.journal.pushEvent({ ...event, meta: { ...event.meta, staleEpoch: true } }, { ...opts, deliver: false }),
          pushDeferred: (event, opts) => { if (this.epoch === epoch) this.host.pushDeferred(event, opts); },
        });
        void startup.then(async () => { if (this.epoch !== epoch) await this.world.stop(); }, () => {}).finally(() => { this.startupPending = false; }).catch(() => {});
        await cancellable(startup, this.lifetime.signal);
        if (this.epoch !== epoch || this.phase !== 'starting') { await this.world.stop(); throw new Error('Startup cancelled'); }
        this.phase = 'started';
      }
      catch (error) {
        try { await this.world.stop(); } finally { if (this.epoch === epoch) { this.phase = 'disconnected'; this.lease.release(); } }
        throw error;
      }
    })();
    return this.transition;
  }

  async disconnect(): Promise<void> {
    if (this.phase === 'disconnected') { this.lifetime.abort(new Error('Runtime stopped')); this.journal.clearDeferred(); return; }
    if (this.phase === 'stopping') return this.transition;
    ++this.epoch;
    this.phase = 'stopping';
    this.lifetime.abort(new Error('Runtime stopped'));
    this.turn = null; this.barrier = null; this.endRequested = false;
    this.journal.clearDeferred();
    this.transition = this.world.stop().finally(() => { this.phase = 'disconnected'; this.lease.release(); });
    return this.transition;
  }

  status() {
    const console = this.world.console?.();
    return { profile: this.profile, toolPrefix: this.toolPrefix, phase: this.phase, run: this.journal.run, latestCursor: this.journal.store.latestCursor(),
      lamps: console?.lamps ?? [], links: console?.links ?? [],
      facts: this.phase === 'started' ? this.world.requestFacts?.() ?? null : null };
  }

  /** Human/operator surface only. Device codes must not enter mc://status, MCP events or model facts. */
  async operatorState() {
    const cfg = this.options.cfg;
    const console = this.world.console?.();
    const connection = this.phase === 'started' && console?.invoke
      ? await console.invoke('connection', 'state', []) : {
        server: { host: cfg.host, port: cfg.port, requestedVersion: cfg.version, actualVersion: null, username: null },
        accounts: null, clients: null,
      };
    return { schema: 'minecraft-client-console/v1', runtime: { phase: this.phase, run: this.journal.run },
      connection, links: this.status().links,
      configuredAccounts: { agent: cfg.username, observer: cfg.client.username, player: cfg.player.username },
      configuredAuthentication: { agent: cfg.auth ?? 'offline', observer: cfg.client.auth ?? 'offline', player: cfg.player.auth ?? 'offline' },
      viewerAssetNote: 'Bundled modern assets: Java 1.20.6. Other versions need matching assets or the fallback viewer.',
    };
  }

  async operatorAction(action: string): Promise<void> {
    if (action === 'connect') return this.connect();
    if (action === 'disconnect') return this.disconnect();
    if (this.phase !== 'started') throw new Error('Connect the client environment first.');
    const method = ({ 'observer.start': 'observer.start', 'observer.stop': 'observer.stop',
      'player.start': 'player.start', 'player.stop': 'player.stop' } as Record<string, string>)[action];
    if (!method) throw new Error('Unknown operator action.');
    const invoke = this.world.console?.().invoke;
    if (!invoke) throw new Error('This environment has no launcher interface.');
    await invoke('connection', method, []);
  }

  async environment(): Promise<string> {
    const { readFileSync } = await import('node:fs');
    return readFileSync(new URL('./ENV_PROMPT.md', import.meta.url), 'utf8').replaceAll('mc_', this.toolPrefix + '_');
  }

  beginTurn(id: string = randomUUID()): TurnReceipt {
    if (this.phase !== 'started') throw new Error('Runtime is disconnected');
    if (!id || id.length > 256) throw new Error('Invalid turn id');
    if (this.closingTurn) throw new Error('Decision turn is ending');
    if (this.endedTurns.has(id)) throw new Error('Decision turn has already ended');
    if (this.turn) { if (this.turn.id === id) return { ...this.turn }; throw new Error('A decision turn is already open'); }
    this.turn = { protocol: PROTOCOL, id, round: ++this.round, phase: 'open' };
    return { ...this.turn };
  }

  async endTurn(id: string): Promise<TurnReceipt> {
    const previous = this.endedTurns.get(id);
    if (previous) return { ...previous };
    if (this.closingTurn) throw new Error('Decision turn is ending');
    if (!this.turn || this.turn.id !== id) throw new Error('Unknown decision turn');
    if ([...this.calls.values()].some(call => call.pending)) throw new Error('Wait for or cancel pending calls before ending the turn');
    const ended: TurnReceipt = { ...this.turn, phase: 'ended' };
    this.closingTurn = true;
    try { await this.world.onTurnEnded?.(); } finally { this.closingTurn = false; }
    this.endedTurns.set(id, ended);
    this.turn = null; this.barrier = null; this.endRequested = false;
    return ended;
  }

  acknowledgeBarrier(requestId: string): void {
    if (this.barrier !== requestId) throw new Error('Unknown tool barrier');
    if (this.calls.get(requestId)?.pending) throw new Error('Barrier call is still pending');
    this.barrier = null;
  }

  cancel(requestId: string): { requestId: string; cancelled: boolean } {
    const call = this.calls.get(requestId);
    if (!call?.pending) return { requestId, cancelled: false };
    call.controller.abort(new Error('Tool call cancelled'));
    return { requestId, cancelled: true };
  }

  task(kind: ExecutionReceipt['kind'], id: string) { return this.executions.get(`${kind}:${id}`) ?? null; }

  currentFacts() {
    const current = this.phase === 'started' ? this.world.requestFacts?.() as import('./contracts.ts').WorldRequestFacts | null : null;
    const connection = { key: 'connection', text: JSON.stringify({ phase: this.phase, host: this.options.cfg.host,
      port: this.options.cfg.port, username: this.options.cfg.username, version: this.options.cfg.version }) };
    return { protocol: PROTOCOL, run: this.journal.run, parts: this.facts.replace({ text: '', snapshotTypes: [],
      parts: [connection, ...(current?.parts ?? (current?.text ? [{key:'world',text:current.text}] : []))] }) };
  }

  async prepareContext(budget: ContextBudget, history = '', countTokens?: (text: string) => number, tools?: import('./contracts.ts').ToolSchema[]) {
    return prepareContext(await this.environment(), this.currentFacts().parts,
      tools ?? this.tools().map(({ name, description, parameters }) => ({ name, description, parameters })), budget, history, countTokens,
      countTokens ? 'host-tokenizer' : 'utf8-byte-upper-bound');
  }

  async events(options: { after?: number; run?: string; limit?: number; waitMs?: number; includeArchived?: boolean } = {}, signal?: AbortSignal) {
    const after = options.after ?? 0, waitMs = options.waitMs ?? 0;
    if (!Number.isFinite(waitMs) || waitMs < 0 || waitMs > 30000) throw new Error('Invalid event wait');
    const combined = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]);
    this.journal.read(after, options.limit ?? 64, options.run);
    const deadline = Date.now() + waitMs;
    do {
      combined.throwIfAborted();
      await cancellable(this.journal.renderDeferred(combined), combined);
      if (this.journal.store.latestCursor() > after || Date.now() >= deadline) break;
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); combined.removeEventListener('abort', abort); };
        const abort = () => { cleanup(); reject(combined.reason); };
        const timer = setTimeout(() => { cleanup(); resolve(); }, Math.min(100, deadline - Date.now()));
        combined.addEventListener('abort', abort, { once: true });
        if (combined.aborted) abort();
      });
    } while (true);
    return this.journal.read(after, options.limit ?? 64, options.run, options.includeArchived === true);
  }

  async call(name: string, args: Record<string, unknown>, options: string | CallOptions = {}, legacySignal?: AbortSignal): Promise<ToolOutcome> {
    const { requestId: callId = randomUUID(), turnId, signal = legacySignal } = typeof options === 'string' ? { requestId: options } : options;
    if (this.phase !== 'started') throw new Error(`Game runtime is disconnected; call ${this.toolPrefix}_connection action:connect first.`);
    if (typeof callId !== 'string' || !callId || callId.length > 256) throw new Error('Invalid request id');
    const signature = createHash('sha256').update(JSON.stringify([name, args, turnId ?? this.turn?.id])).digest('hex');
    const prior = this.calls.get(callId);
    if (prior) { if (prior.signature !== signature) throw new Error('Request id reused with different arguments'); return prior.promise; }
    const replay = this.requests.read(callId, signature);
    if (replay) return replay;
    if (this.closingTurn) throw new Error('Decision turn is ending');
    if (turnId && this.turn?.id !== turnId) throw new Error('Unknown decision turn');
    if (this.barrier) throw new Error(`Acknowledge tool barrier ${this.barrier} before the next call`);
    if (this.turn && this.endRequested) throw new Error('Host must end the current decision turn before submitting more calls');
    const tool = this.tools().find(candidate => candidate.name === name);
    if (!tool) throw new Error(`Unknown game tool: ${name}`);
    if (signal?.aborted) throw new Error('Tool call cancelled before submission.');
    if (tool.barrierAfter && [...this.calls.values()].some(call => call.pending)) throw new Error('Drain pending calls before a barrier tool');
    if (tool.barrierAfter) this.barrier = callId;
    this.requests.write({ requestId: callId, signature, phase: 'pending' });
    const controller = new AbortController();
    const combined = AbortSignal.any([this.lifetime.signal, controller.signal, ...(signal ? [signal] : [])]);
    const turn = this.turn;
    const state = { signature, controller, pending: true, promise: null as unknown as Promise<ToolOutcome> };
    this.calls.set(callId, state);
    state.promise = Promise.resolve().then(async () => {
    this.metrics.toolStarted(callId, name);
    const queued: EventEnvelope[] = [];
    try {
      combined.throwIfAborted();
      const result = await cancellable(tool.handler(args, { role: this.options.agentName ?? 'agent', log: this.options.log,
        callId, signal: combined, ...(turn ? { turnId: turn.id, round: turn.round } : {}), queueExternalEvents: events => queued.push(...events) }), combined);
      const outcome: ToolOutcome = typeof result === 'string' ? { text: result } : { ...result };
      outcome.control = { protocol: PROTOCOL, requestId: callId, ...(turn ? { turnId: turn.id } : {}),
        barrierAfter: tool.barrierAfter === true, endTurnRequested: outcome.endsTurn === true || tool.endsTurn === true, turnEnded: false };
      if (turn && outcome.control.endTurnRequested) this.endRequested = true;
      if (outcome.execution) this.executions.set(`${outcome.execution.kind}:${outcome.execution.id}`, outcome.execution);
      if (queued.length) outcome.events = [...(outcome.events ?? []), ...queued];
      if (queued.length) outcome.text += '\n[Game events returned with this call]\n' + JSON.stringify(queued);
      this.requests.write({ requestId: callId, signature, phase: 'returned', outcome });
      this.metrics.toolEnded(callId, outcome.failed === true);
      appendFileSync(join(this.options.dataDir, 'tools.jsonl'), JSON.stringify({ at: new Date().toISOString(),
        run: this.journal.run, callId, name, failed: outcome.failed === true, text: outcome.text }) + '\n');
      return outcome;
    } catch (error) {
      this.requests.write({ requestId: callId, signature, phase: 'failed', error: String(error) });
      this.metrics.toolEnded(callId, true);
      appendFileSync(join(this.options.dataDir, 'tools.jsonl'), JSON.stringify({ at: new Date().toISOString(),
        run: this.journal.run, callId, name, failed: true, error: String(error) }) + '\n');
      throw error;
    } finally {
      state.pending = false;
      if (this.calls.size > 1024) for (const [id, call] of this.calls) {
        if (!call.pending && id !== this.barrier) this.calls.delete(id);
        if (this.calls.size <= 512) break;
      }
    }
    });
    return state.promise;
  }
}

function cancellable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason ?? new Error('Cancelled')); };
    signal.addEventListener('abort', abort, { once: true });
    work.then(value => { signal.removeEventListener('abort', abort); if (signal.aborted) reject(signal.reason); else resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); });
    if (signal.aborted) abort();
  });
}
