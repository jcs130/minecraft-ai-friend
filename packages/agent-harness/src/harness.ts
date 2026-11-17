import { join } from 'node:path';
import type { Fact, McEventLike, MemoryEventObserver, MinecraftMemoryIntegration, ObservedFacts } from 'agent-mc-memory';
import { classifyBodyEvent, EventHub } from './events.ts';
import { IntentExecutor, type ExecutorOptions } from './executor.ts';
import { IntentManager } from './intents.ts';
import { ExplicitStepsPlanner, type BodyPort, type Planner } from './planner.ts';
import { NO_REFLECTION, type HostMemoryWriter, type ReflectionTrigger, type Reflector } from './reflection.ts';
import { buildSummary } from './summary.ts';
import { TERMINAL_STATES, type HarnessApi, type HarnessEvent, type Intent, type IntentInput, type IntentPatch,
  type IntentState, type Summary, type SummaryOptions } from './types.ts';
import { AsyncWorkers } from './workers.ts';
import { bodyAdapterPort, toMcEvent } from './body/harness-port.ts';
import type { BodyAdapter } from './body/types.ts';

export interface HarnessRuntimeOptions {
  /** The body's Minecraft username (to tell own chat from players'). */
  self: string;
  /** Hot/Warm/Cold memory (agent-mc-memory). Optional: without it summaries omit memory facts. */
  memory?: MinecraftMemoryIntegration | null;
  /** Persist intents here (`<dir>/intents.json`). Omit for in-memory only. */
  dataDir?: string;
  planner?: Planner;
  reflector?: Reflector;
  hostMemory?: HostMemoryWriter;
  executor?: ExecutorOptions;
  now?: () => Date;
  log?: (message: string, data?: Record<string, unknown>) => void;
}

/**
 * Harness Runtime: the middle layer between a persona host and the Minecraft body.
 * Host → submitIntent/getSummary/subscribe/pullEvents/pause/resume/updateIntent/cancel.
 * Body → `observer` (host events) and an optional BodyPort for executing intents.
 */
export class HarnessRuntime implements HarnessApi {
  readonly intents: IntentManager;
  readonly events: EventHub;
  readonly executor: IntentExecutor;
  readonly workers: AsyncWorkers;
  private readonly now: () => Date;
  private readonly reflector: Reflector;
  /** Pass to MinecraftAgentClient `eventObservers` (feeds memory, key events and task receipts). Never throws. */
  readonly observer: MemoryEventObserver;

  constructor(private readonly options: HarnessRuntimeOptions) {
    this.now = options.now ?? (() => new Date());
    this.intents = new IntentManager({ file: options.dataDir ? join(options.dataDir, 'intents.json') : undefined, now: this.now });
    this.events = new EventHub(500, this.now);
    this.workers = new AsyncWorkers({ concurrency: 1, log: options.log });
    this.reflector = options.reflector ?? NO_REFLECTION;
    this.executor = new IntentExecutor(this.intents, options.planner ?? new ExplicitStepsPlanner(),
      { summary: async () => (await this.getSummary({ maxTokens: 200 })).text, capabilities: () => this.bodyAdapter?.capabilities() ?? null },
      { log: options.log, ...options.executor });
    this.intents.onChange((intent, from) => this.onIntentChange(intent, from));
    this.observer = (event, facts) => this.observe(event, facts);
  }

  // ---- body side ----
  private bodyAdapter: BodyAdapter | null = null;
  private offBody: (() => void) | null = null;
  /** Low-level: bind a raw BodyPort (tests / legacy). Prefer `attachBody`. */
  bindBody(body: BodyPort | null): void { this.executor.bindBody(body); }

  /**
   * Attach a unified body (Mineflayer / Numen / maid). Its events feed memory, key events and task receipts; with `execute`
   * the executor drives it through `bodyAdapterPort`. Planner and gateway read its capabilities.
   */
  attachBody(body: BodyAdapter | null, options: { execute?: boolean } = {}): void {
    this.offBody?.(); this.offBody = null;
    this.bodyAdapter = body;
    if (!body) { this.executor.bindBody(null); return; }
    this.offBody = body.subscribe(e => {
      if (e.kind === 'safety' || (e.kind === 'lifecycle' && e.severity >= 2) || e.kind === 'connection') {
        this.events.emit({ kind: e.kind === 'safety' ? 'safety' : 'body', severity: e.kind === 'safety' ? 3 : 2, at: e.at, text: e.text.slice(0, 200),
          data: { bodyKind: e.bodyKind, bodyEvent: e.kind, ...(e.kind === 'safety' ? { halted: e.data.halted ?? true } : {}) } });
        if (e.kind === 'safety') void this.executor.interrupt('paused', `safety halt: ${e.text.slice(0, 120)}`);
      }
      const { event, facts } = toMcEvent(e, body);
      this.observe(event, facts);
    });
    if (options.execute !== false) this.executor.bindBody(bodyAdapterPort(body));
  }
  body(): BodyAdapter | null { return this.bodyAdapter; }

  private observe(event: McEventLike, facts: ObservedFacts | null | (() => ObservedFacts | null)): void {
    try { this.options.memory?.observer(event, facts); } catch { /* memory observer is already isolated */ }
    try {
      this.executor.observeExecution(event.execution);
      const draft = classifyBodyEvent(event, this.options.self);
      if (!draft) return;
      const emitted = this.events.emit(draft);
      if (emitted.kind === 'death' || emitted.kind === 'task_failed')
        this.reflect({ kind: emitted.kind, intent: this.intents.active(), events: [emitted] });
    } catch (error) {
      this.options.log?.('harness observer failed', { type: event.type, error: String(error).slice(0, 200) });
    }
  }

  private onIntentChange(intent: Intent, from: IntentState | null): void {
    if (from === intent.state && intent.state !== 'active') {
      this.events.emit({ kind: 'intent_state', severity: 1, intentId: intent.id, text: `意图已更新：${intent.goal}`, data: { state: intent.state } });
      return;
    }
    if (from === intent.state) return; // progress within active: visible in summary, not pushed
    const needsHost = intent.state === 'paused' && !!intent.reason && /^No planner|not allowed|Too many|Step not supported|safety halt/.test(intent.reason);
    const severity: 1 | 2 | 3 = intent.state === 'failed' || needsHost ? 3 : intent.state === 'done' ? 2 : 1;
    const label = { queued: '排队', active: '开始执行', paused: '暂停', done: '完成', cancelled: '取消', failed: '失败' }[intent.state];
    this.events.emit({ kind: 'intent_state', severity, intentId: intent.id,
      text: `意图${label}：${intent.goal}${intent.reason ? `（${intent.reason.slice(0, 80)}）` : ''}`,
      data: { from, state: intent.state, needsHost } });
    if (TERMINAL_STATES.includes(intent.state)) this.reflect({ kind: 'intent_ended', intent, events: this.events.recent(5, 2) });
  }

  private reflect(trigger: ReflectionTrigger): void {
    if (this.reflector === NO_REFLECTION) return;
    this.workers.enqueue(`reflect:${trigger.kind}`, async signal => {
      const note = await this.reflector.reflect(trigger, signal);
      if (!note || signal.aborted) return;
      this.events.emit({ kind: 'reflection', severity: 1, intentId: trigger.intent?.id, text: `反思：${note.summary.slice(0, 140)}` });
      await this.options.hostMemory?.write(note, trigger);
    });
  }

  // ---- host API ----
  async submitIntent(input: IntentInput): Promise<{ intentId: string; state: IntentState }> {
    const intent = this.intents.submit(input);
    this.executor.maybePreempt(intent);
    return { intentId: intent.id, state: intent.state };
  }

  async getSummary(options: SummaryOptions = {}): Promise<Summary> {
    const active = this.intents.active();
    const topic = options.topic?.trim().slice(0, 100) || undefined;
    const viewer = options.viewer;
    const mine = viewer === undefined ? {} : { owner: viewer };
    const shownActive = active && viewer !== undefined && active.owner !== viewer
      ? { ...active, goal: '（其他代理的意图）', reason: null, constraints: {}, hostRef: null } : active;
    const visible = (e: HarnessEvent) => viewer === undefined || !e.intentId || this.intents.get(e.intentId)?.owner === viewer;
    return buildSummary({
      topic, maxTokens: options.maxTokens, now: this.now(),
      executor: this.executor.isPaused() ? 'paused' : !this.executor.hasBody() ? 'no-body' : active ? 'running' : 'idle',
      active: shownActive, queued: this.intents.list({ states: ['queued'], limit: 3, ...mine }),
      paused: this.intents.list({ states: ['paused'], limit: 2, ...mine }),
      events: this.events.recent(50, 2).filter(visible).slice(-5), facts: await this.memoryLines(topic),
      body: this.bodyLine(),
    });
  }

  private async memoryLines(topic: string | undefined): Promise<string[]> {
    const current = this.options.memory?.current();
    if (!current) return [];
    try {
      const res = await current.memory.currentFacts({ ...(topic ? { text: topic } : {}), limit: 8 }, { graphiti: !!topic });
      return res.facts.map(factLine);
    } catch { return []; }
  }

  subscribe(listener: (event: HarnessEvent) => void, filter: { minSeverity?: 1 | 2 | 3 } = {}): () => void {
    return this.events.subscribe(listener, filter.minSeverity ?? 1);
  }
  pullEvents(options: { after?: number; limit?: number; minSeverity?: 1 | 2 | 3 } = {}) {
    return this.events.pull(options.after ?? 0, options.limit ?? 20, options.minSeverity ?? 1);
  }

  async pause(intentId?: string, reason = 'paused by host'): Promise<Intent | null> {
    if (!intentId) { this.executor.setPaused(true); return null; }
    const intent = this.require(intentId);
    if (intent.state === 'active') await this.executor.interrupt('paused', reason, intentId);
    else if (intent.state === 'queued') this.intents.transition(intentId, 'paused', { reason });
    else if (intent.state !== 'paused') throw new Error(`Intent ${intentId} is ${intent.state}`);
    return this.intents.get(intentId);
  }

  async resume(intentId?: string): Promise<Intent | null> {
    if (!intentId) { this.executor.setPaused(false); return null; }
    const intent = this.require(intentId);
    if (intent.state !== 'paused') throw new Error(`Intent ${intentId} is ${intent.state}, not paused`);
    this.intents.transition(intentId, 'queued', { reason: null });
    this.executor.pump();
    return this.intents.get(intentId);
  }

  async updateIntent(intentId: string, patch: IntentPatch): Promise<Intent> {
    const updated = this.intents.update(intentId, patch);
    if (updated.state === 'queued') this.executor.maybePreempt(updated);
    return updated;
  }

  async cancel(intentId: string, reason = 'cancelled by host'): Promise<Intent> {
    const intent = this.require(intentId);
    if (TERMINAL_STATES.includes(intent.state)) throw new Error(`Intent ${intentId} is ${intent.state}`);
    if (intent.state === 'active') await this.executor.interrupt('cancelled', reason, intentId);
    else this.intents.transition(intentId, 'cancelled', { reason });
    return this.intents.get(intentId)!;
  }

  private bodyLine(): string | null {
    const b = this.bodyAdapter; if (!b) return null;
    const h = b.health(), id = b.identity();
    return `身体：${b.kind}${id?.name ? `「${id.name}」` : ''}｜${h.lifecycle}${h.safety?.halted ? '｜安全停止中' : ''}`;
  }

  getIntent(intentId: string): Intent | null { return this.intents.get(intentId); }
  listIntents(options: { states?: IntentState[]; limit?: number; owner?: string } = {}): Intent[] { return this.intents.list(options); }

  private require(id: string): Intent {
    const i = this.intents.get(id); if (!i) throw new Error(`Unknown intent ${id}`); return i;
  }

  /** Wait for background work (tests/shutdown). */
  async idle(): Promise<void> { await this.options.memory?.idle(); await this.workers.idle(); }

  async close(): Promise<void> {
    await this.executor.close();
    await this.workers.close();
    await this.options.memory?.close();
  }
}

export function factLine(f: Fact): string {
  const object = f.object ? ` ${f.object.name.replace(/^[^|]*\|/, '')}` : '';
  const value = f.value !== null ? `=${f.value}` : '';
  return `${f.subject.name} ${f.relation}${object}${value}（${f.validAt.slice(0, 10)}起）`;
}
