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
      { summary: async () => (await this.getSummary({ maxTokens: 200 })).text }, { log: options.log, ...options.executor });
    this.intents.onChange((intent, from) => this.onIntentChange(intent, from));
    this.observer = (event, facts) => this.observe(event, facts);
  }

  // ---- body side ----
  bindBody(body: BodyPort | null): void { this.executor.bindBody(body); }

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
    const needsHost = intent.state === 'paused' && !!intent.reason && /^No planner|not allowed|Too many/.test(intent.reason);
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
    return buildSummary({
      topic, maxTokens: options.maxTokens, now: this.now(),
      executor: this.executor.isPaused() ? 'paused' : !this.executor.hasBody() ? 'no-body' : active ? 'running' : 'idle',
      active, queued: this.intents.list({ states: ['queued'], limit: 3 }), paused: this.intents.list({ states: ['paused'], limit: 2 }),
      events: this.events.recent(5, 2), facts: await this.memoryLines(topic),
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
    if (intent.state === 'active') await this.executor.interrupt('cancelled', reason, intentId);
    else this.intents.transition(intentId, 'cancelled', { reason });
    return this.intents.get(intentId)!;
  }

  getIntent(intentId: string): Intent | null { return this.intents.get(intentId); }
  listIntents(options: { states?: IntentState[]; limit?: number } = {}): Intent[] { return this.intents.list(options); }

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
