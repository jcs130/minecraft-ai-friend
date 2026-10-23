import { randomUUID } from 'node:crypto';
import { createMinecraftChoiceTool } from './choice.ts';
import { familiarStepAction } from './familiar-action.ts';
import { ClientOperationLearning } from './operation-learning.ts';
import { operationObservation, type OperationAttribution } from '../../core/operation-experience.ts';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EventEnvelope, Logger, ModelFacts, ToolOutcome, World, WorldHost, WorldRequestFacts } from './contracts.ts';
import { MinecraftClientWorld } from './world.ts';
import { JavaClientWorld, JAVA_CLIENT_ENVIRONMENT } from './java-client.ts';
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
import { GameMemoryBook } from '../../core/game-memory.ts';
import { GameMemoryService } from '../../core/game-memory-service.ts';
import { KNOWLEDGE_TOOL, readMinecraftKnowledge } from '../../core/knowledge.ts';
import { worldIdentityOf } from '../../core/server-config.ts';
import { readRealmMarker } from '../../core/server.ts';

export interface MinecraftClientOptions {
  cfg: MinecraftClientConfig;
  dataDir: string;
  timezone?: string;
  agentName?: string;
  modelFacts?: ModelFacts;
  decisions?: WorldHost['decisions'];
  /** Explicit script mode; releases a barrier only after its call has settled. */
  autoAcknowledgeBarriers?: boolean;
  log: Logger;
}

export type ClientEnvironment = World & {
  requestFacts?(): unknown;
  connectionReadiness?(): { ready: boolean; phase: string } | null;
};

/** The caller owns reasoning, personal memory and wakeups. The client owns game receipts and an optional game notebook. */
export class MinecraftAgentClient {
  /** Inspect a durable original request, including across reconnects; never resubmit it. */
  request(requestId: string) { return this.requests.inspect(requestId); }
  readonly journal: AgentJournal;
  readonly metrics: AgentMetrics;
  readonly learning: ClientOperationLearning;
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
  private offlineMemoryCalls = 0;
  private readonly tacticCalls = new Map<string, { signature: string; pending: boolean; controller: AbortController; promise: Promise<ToolOutcome> }>();
  private readonly hostChoice = createMinecraftChoiceTool(() => this.host,
    () => this.phase === 'started' ? (this.world.requestFacts?.() as WorldRequestFacts | null) ?? null : null);

  constructor(protected readonly options: MinecraftClientOptions,
    private readonly world: ClientEnvironment = options.cfg.provider === 'java-client' ? new JavaClientWorld(options.cfg, undefined,
      { dataDir: options.dataDir, agentName: options.agentName })
      : new MinecraftClientWorld({ cfg: options.cfg, dataDir: options.dataDir,
        timezone: options.timezone ?? 'UTC', botName: options.agentName ?? options.cfg.username }),
    readonly binding: { profile: string; toolPrefix: 'mc' | 'mymc' } = { profile: 'minecraft', toolPrefix: 'mc' }) {
    this.journal = new AgentJournal(options.dataDir, 1024, world.id);
    this.learning = new ClientOperationLearning(options.dataDir, this.journal.run,
      () => this.world.requestFacts?.() as WorldRequestFacts | null,
      () => ({realm:`weak:${options.cfg.host}:${options.cfg.port}|`,account:`${options.cfg.auth??'offline'}:${options.cfg.username}`,
        agent:options.agentName??options.cfg.username}));
    this.facts = new CurrentFacts(this.journal);
    this.requests = new RequestLedger(this.journal);
    this.metrics = new AgentMetrics(this.journal.run, options.dataDir, handle => this.journal.blob(handle) !== null);
    this.lease = new AgentConnectionLease(options.dataDir, this.journal.run);
    this.host = {
      pushEvent: async (event, opts) => {
        if (event.execution) this.recordExecution(event.execution);
        return this.journal.pushEvent(event, opts);
      },
      pushDeferred: (event, opts) => this.journal.pushDeferred(event, opts),
      drainPendingEvents: filter => this.journal.drainPendingEvents(filter),
      store: this.journal.store,
      blob: handle => this.journal.blob(handle),
      modelFacts: options.modelFacts ?? { model: () => '', accepts: () => false, contextWindow: () => undefined },
      decisions: options.decisions,
      recallGameLessons: query=>this.learning.recall(query),
      reportUsage: (usage, metadata) => appendFileSync(join(options.dataDir, 'usage.jsonl'), JSON.stringify({
        at: new Date().toISOString(), run: this.journal.run, usage, metadata }) + '\n'),
      log: options.log,
    };
  }

  get profile() { return this.binding.profile; }
  private recordExecution(receipt: ExecutionReceipt): void {
    this.learning.execution(receipt);
    const key = `${receipt.kind}:${receipt.id}`, previous = this.executions.get(key);
    // A very fast background operation can finish before its admission RPC returns.
    if (previous?.terminal && !receipt.terminal) return;
    this.executions.set(key, receipt);
  }
  get toolPrefix() { return this.binding.toolPrefix; }
  /** Pure preparation on the selected tool; preserves backend-specific validation and exact IDs. */
  prepareFastAction(name: string, args: Record<string, unknown>) {
    if (this.phase !== 'started' || this.status().connection?.ready === false || name !== `${this.toolPrefix}_do`) return null;
    const tool = this.tools().find(t => t.name === name); if (!tool) return null;
    if (tool.familiarAction) return tool.familiarAction(structuredClone(args));
    return this.options.cfg.provider === 'java-client' ? null : familiarStepAction(args);
  }
  protected validateConfig(): void { assertMinecraftReady(this.options.cfg); }

  tools() {
    const tools = this.world.tools(), name = `${this.toolPrefix}_choose`;
    return this.options.decisions && !tools.some(tool => tool.name === name || tool.name === 'mc_choose')
      ? [...tools, { ...this.hostChoice, name }] : tools;
  }

  async connect(): Promise<void> {
    if (this.phase === 'started') return;
    if (this.phase === 'starting') return this.transition;
    if (this.phase === 'stopping') throw new Error('Game runtime is stopping.');
    if (this.startupPending) throw new Error('Previous engine startup is still draining');
    if (this.offlineMemoryCalls) throw new Error('Wait for pending offline memory calls before connecting');
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
    const connection = this.world.connectionReadiness?.() ?? console?.connection ?? null;
    return { profile: this.profile, toolPrefix: this.toolPrefix, phase: this.phase, run: this.journal.run, latestCursor: this.journal.store.latestCursor(),
      learning:this.learning.status(),
      connection: connection && typeof connection.ready === 'boolean' && typeof connection.phase === 'string'
        ? { ready: connection.ready, phase: connection.phase } : null,
      lamps: console?.lamps ?? [], links: console?.links ?? [],
      facts: this.phase === 'started' ? this.world.requestFacts?.() ?? null : null };
  }

  /** Human/operator surface only. Device codes must not enter mc://status, MCP events or model facts. */
  async operatorState() {
    const cfg = this.options.cfg;
    const console = this.world.console?.();
    const connection = ['starting', 'started'].includes(this.phase) && console?.invoke
      ? await console.invoke('connection', 'state', []) : {
        server: { host: cfg.host, port: cfg.port, requestedVersion: cfg.version, actualVersion: null, username: null },
        accounts: null, clients: null,
      };
    return { schema: 'minecraft-client-console/v1', runtime: { phase: this.phase, run: this.journal.run },
      connection, links: this.status().links,
      configuredAccounts: { agent: cfg.username, observer: cfg.client.username, player: cfg.player.username },
      configuredAuthentication: { agent: cfg.auth ?? 'offline', observer: cfg.client.auth ?? 'offline', player: cfg.player.auth ?? 'offline' },
      viewerAssetNote: 'Modern viewer assets must match the action connection version; the bundled version and hashes are pinned in release-sources.json.',
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
    if (this.options.cfg.provider === 'java-client') return JAVA_CLIENT_ENVIRONMENT;
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
    return { protocol: PROTOCOL, run: this.journal.run,
      ...(current?.decisionStability ? { decisionStability: structuredClone(current.decisionStability) } : {}),
      observation: operationObservation(current?.experience?.observation), parts: this.facts.replace({ text: '', snapshotTypes: [],
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
    const { requestId: callId = randomUUID(), turnId, signal = legacySignal, attribution } = typeof options === 'string' ? { requestId: options } : options;
    const offlineMemory = this.phase === 'disconnected' && name === `${this.toolPrefix}_memory`;
    const offlineKnowledge = this.phase === 'disconnected' && name === `${this.toolPrefix}_knowledge`;
    const offlineCall = offlineMemory || offlineKnowledge;
    if (this.phase !== 'started' && !offlineCall) throw new Error(`Game runtime is disconnected; call ${this.toolPrefix}_connection action:connect first.`);
    if (typeof callId !== 'string' || !callId || callId.length > 256) throw new Error('Invalid request id');
    const signature = createHash('sha256').update(JSON.stringify([name, args, turnId ?? this.turn?.id, ...(attribution ? [attribution] : [])])).digest('hex');
    const prior = this.calls.get(callId);
    if (prior) { if (prior.signature !== signature) throw new Error('Request id reused with different arguments'); return prior.promise; }
    const replay = this.requests.read(callId, signature);
    if (replay) return replay;
    const stopping = name === `${this.toolPrefix}_stop`;
    const tactics = [...this.tacticCalls.values()].filter(c => c.pending);
    if (tactics.length && !stopping) throw new Error('Wait for or cancel the pending host tactic before a planner tool');
    if (stopping) for (const tactic of tactics) tactic.controller.abort(new Error('Planner stopped the body'));
    if (this.closingTurn && !stopping) throw new Error('Decision turn is ending');
    if (turnId && this.turn?.id !== turnId) throw new Error('Unknown decision turn');
    if (this.barrier && !stopping) throw new Error(`Acknowledge tool barrier ${this.barrier} before the next call`);
    if (this.turn && this.endRequested && !stopping) throw new Error('Host must end the current decision turn before submitting more calls');
    const tool = this.tools().find(candidate => candidate.name === name)
      ?? (offlineKnowledge ? { ...KNOWLEDGE_TOOL, name, handler: async () => '' } : undefined);
    if (!tool) throw new Error(`Unknown game tool: ${name}`);
    if (signal?.aborted) throw new Error('Tool call cancelled before submission.');
    if (tool.barrierAfter && [...this.calls.values()].some(call => call.pending)) throw new Error('Drain pending calls before a barrier tool');
    if (tool.barrierAfter) this.barrier = callId;
    if (offlineCall) {
      this.lease.acquire();
      if (!this.offlineMemoryCalls && this.lifetime.signal.aborted) this.lifetime = new AbortController();
      this.offlineMemoryCalls++;
    }
    try { this.requests.write({ requestId: callId, signature, phase: 'pending' }); }
    catch (error) {
      if (offlineCall && --this.offlineMemoryCalls === 0) this.lease.release();
      if (this.barrier === callId) this.barrier = null;
      throw error;
    }
    const controller = new AbortController();
    const combined = AbortSignal.any([this.lifetime.signal, controller.signal, ...(signal ? [signal] : [])]);
    const turn = this.turn;
    const state = { signature, controller, pending: true, promise: null as unknown as Promise<ToolOutcome> };
    this.calls.set(callId, state);
    state.promise = Promise.resolve().then(async () => {
    const queued: EventEnvelope[] = [];
    const experience = this.learning.begin(tool,args,callId,attribution);
    try {
      this.metrics.toolStarted(callId, name);
      combined.throwIfAborted();
      const result = await cancellable(offlineKnowledge
        ? Promise.resolve({ text: JSON.stringify(readMinecraftKnowledge(args, this.options.cfg.version)) })
        : offlineMemory && this.options.cfg.provider !== 'java-client' ? this.callOfflineMemory(args, combined) : tool.handler(args, {
        role: this.options.agentName ?? 'agent', log: this.options.log, callId, signal: combined, attribution,
        ...(turn ? { turnId: turn.id, round: turn.round } : {}), queueExternalEvents: events => queued.push(...events) }), combined);
      const outcome: ToolOutcome = typeof result === 'string' ? { text: result } : { ...result };
      const recorded = this.learning.finish(experience,outcome);
      // Observation artifacts have immutable metadata shared by capture and later reads.
      if(recorded&&outcome.execution?.kind!=='observation') outcome.meta={...outcome.meta,experience:recorded};
      if(name.endsWith('_choose')) {
        // Only schema-owned choice metadata; never retain candidate prose or the model request.
        try { const chosen=JSON.parse(outcome.text), candidates=Array.isArray(args.candidates)?args.candidates:[];
          const decisionId=chosen.decisionId??callId;
          const decision=this.learning.recordDecision({id:decisionId,category:String(args.category),selected:chosen.choice??null,status:chosen.status??'unknown',
            candidates:candidates.map(c=>({id:c.id,ready:c.ready,probability:c.id===chosen.choice?chosen.probability:null})),
            model:chosen.model??null,elapsedMs:chosen.elapsedMs??null,inputTokens:chosen.inputTokens??null,recalledMemoryRefs:chosen.recalledMemoryRefs??[],
            sessionId:attribution?.sessionId,policy:attribution?.policy});
          if(decision) outcome.meta={...outcome.meta,decisionId,experience:{id:decision.id,protocol:decision.schema}};
        } catch { /* Unrecognized advice stays unknown; no inferred decision. */ }
      }
      outcome.control = { protocol: PROTOCOL, requestId: callId, ...(turn ? { turnId: turn.id } : {}),
        barrierAfter: tool.barrierAfter === true, endTurnRequested: outcome.endsTurn === true || tool.endsTurn === true, turnEnded: false };
      if (turn && outcome.control.endTurnRequested) this.endRequested = true;
      if (outcome.execution) this.recordExecution(outcome.execution);
      if (queued.length) outcome.events = [...(outcome.events ?? []), ...queued];
      if (queued.length) outcome.text += '\n[Game events returned with this call]\n' + JSON.stringify(queued);
      this.requests.write({ requestId: callId, signature, phase: 'returned', outcome });
      this.metrics.toolEnded(callId, outcome.failed === true);
      appendFileSync(join(this.options.dataDir, 'tools.jsonl'), JSON.stringify({ at: new Date().toISOString(),
        run: this.journal.run, callId, name, failed: outcome.failed === true, text: outcome.text }) + '\n');
      return outcome;
    } catch (error) {
      this.learning.finish(experience,null);
      this.requests.write({ requestId: callId, signature, phase: 'failed', error: String(error), ...(combined.aborted ? {cancelled:true} : {}) });
      this.metrics.toolEnded(callId, true);
      appendFileSync(join(this.options.dataDir, 'tools.jsonl'), JSON.stringify({ at: new Date().toISOString(),
        run: this.journal.run, callId, name, failed: true, error: String(error) }) + '\n');
      throw error;
    } finally {
      state.pending = false;
      if (offlineCall && --this.offlineMemoryCalls === 0) this.lease.release();
      if (this.options.autoAcknowledgeBarriers && this.barrier === callId) this.acknowledgeBarrier(callId);
      if (this.calls.size > 1024) for (const [id, call] of this.calls) {
        if (!call.pending && id !== this.barrier) this.calls.delete(id);
        if (this.calls.size <= 512) break;
      }
    }
    });
    return state.promise;
  }

  /** Explicit host fast-control port, independent of a planner's open reasoning turn.
   * Sampling is read-only and does not fill the action journal. Choices retain request identities;
   * the engine revalidates ownership, connection, target and geometry before applying them.
   */
  async hostTactics(args: { battlefield: true } | { choice: Record<string, unknown> },
    options: { requestId?: string; signal?: AbortSignal; attribution?: OperationAttribution } = {}): Promise<ToolOutcome> {
    if (this.phase !== 'started') throw new Error('Game runtime is disconnected');
    const sample = Object.keys(args).length === 1 && 'battlefield' in args && args.battlefield === true;
    const choice = Object.keys(args).length === 1 && 'choice' in args && args.choice && typeof args.choice === 'object';
    if (!sample && !choice) throw new Error('Host tactics accepts only a battlefield sample or an exact choice');
    const name = `${this.toolPrefix}_combat_tactic`, tool = this.tools().find(t => t.name === name);
    if (!tool) throw new Error('Host tactics unavailable');
    const controller = new AbortController();
    const signal = AbortSignal.any([this.lifetime.signal, controller.signal, ...(options.signal ? [options.signal] : [])]);
    signal.throwIfAborted();
    const callId = options.requestId ?? randomUUID();
    if (!callId || callId.length > 256) throw new Error('Invalid request id');
    const invoke = async () => {
      const result = await cancellable(tool.handler(args, { role: 'host-decision', log: this.options.log, callId, signal }), signal);
      return typeof result === 'string' ? { text: result } : result;
    };
    if (sample) return invoke();
    const signature = createHash('sha256').update(JSON.stringify(['host-tactics', args,...(options.attribution?[options.attribution]:[])])).digest('hex');
    const prior = this.tacticCalls.get(callId);
    if (prior) { if (prior.signature !== signature) throw new Error('Request id reused with different arguments'); return prior.promise; }
    const replay = this.requests.read(callId, signature); if (replay) return replay;
    const experience=this.learning.begin(tool,args,callId,{controller:'system1',...options.attribution});
    if (this.closingTurn || this.barrier || [...this.calls.values(), ...this.tacticCalls.values()].some(c => c.pending)) {
      const outcome:ToolOutcome={ text: 'Planner tool owns admission; refresh the battlefield before another choice.', failed: true,
        meta: { protocol: 'agent-mc-tactics/v1', receipt: { accepted: false, meaning: 'planner-tool-active', goalCompleted: false } } };
      this.learning.finish(experience,outcome);this.requests.write({requestId:callId,signature,phase:'returned',outcome});return outcome;
    }
    this.requests.write({ requestId: callId, signature, phase: 'pending' });
    const state = { signature, controller, pending: true, promise: null as unknown as Promise<ToolOutcome> };
    this.tacticCalls.set(callId, state);
    const promise = Promise.resolve().then(() => { signal.throwIfAborted(); return invoke(); }).then(outcome => {
      const recorded=this.learning.finish(experience,outcome);if(recorded)outcome.meta={...outcome.meta,experience:recorded};
      this.requests.write({ requestId: callId, signature, phase: 'returned', outcome });
      return outcome;
    }, error => { this.learning.finish(experience,null);this.requests.write({ requestId: callId, signature, phase: 'failed', error: String(error) }); throw error; })
      .finally(() => { state.pending = false; });
    state.promise = promise;
    if (this.tacticCalls.size > 256) this.tacticCalls.delete(this.tacticCalls.keys().next().value!);
    return promise;
  }

  /** Same core service without starting the game engine, reconnect loop, launcher or a model. */
  private async callOfflineMemory(args: Record<string, unknown>, signal: AbortSignal): Promise<ToolOutcome> {
    const cfg = this.options.cfg, address = `${cfg.host}:${cfg.port}`;
    const world = worldIdentityOf(cfg.local.serverDir, address);
    const marker = world.local ? readRealmMarker(join(cfg.local.serverDir, world.key)) : null;
    // Do not create a world identity or silently bind local notes to a temporary address.
    if (world.local && !marker && args.action !== 'help' && args.action !== undefined)
      throw new Error('Local world identity is not initialized; connect explicitly before using its notebook');
    const directory = join(this.options.dataDir, 'minecraft-memory');
    const memory = new GameMemoryService(new GameMemoryBook(directory), directory);
    const result = await memory.execute(args, { scope: {
      realm: marker ? `uuid:${marker.uuid}` : `weak:${address}|`,
      account: `${cfg.auth ?? 'offline'}:${cfg.username}`, agent: this.options.agentName ?? cfg.username,
    }, dimension: null }, cfg.memory, signal);
    return { text: JSON.stringify(result), meta: { gameMemory: result } };
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
