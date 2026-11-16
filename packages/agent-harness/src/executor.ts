import type { IntentManager } from './intents.ts';
import { URGENT } from './intents.ts';
import type { BodyOutcome, BodyPort, Planner, PlanContext } from './planner.ts';
import type { Intent } from './types.ts';

export interface ExecutorOptions {
  /** Body tool used to stop work on pause/cancel/preempt. */
  stopTool?: string;
  /** Max wait for an accepted body task to report a terminal event. */
  stepTimeoutMs?: number;
  log?: (message: string, data?: Record<string, unknown>) => void;
}

interface Running { intentId: string; controller: AbortController; done: Promise<void> }

/**
 * Single-lane intent executor (the body is exclusive). Picks the highest-priority queued intent, plans it,
 * runs its steps through the BodyPort and waits for asynchronous task receipts from body events.
 * Without a bound body it never starts anything: intents stay queued.
 */
export class IntentExecutor {
  private body: BodyPort | null = null;
  private running: Running | null = null;
  private paused = false;
  private pumping = false;
  private readonly waiters = new Map<string, (phase: string) => void>();
  private readonly seenTerminal = new Map<string, string>();

  constructor(private readonly intents: IntentManager, private readonly planner: Planner,
    private readonly context: PlanContext, private readonly options: ExecutorOptions = {}) {}

  bindBody(body: BodyPort | null): void { this.body = body; this.pump(); }
  hasBody(): boolean { return this.body !== null; }
  isPaused(): boolean { return this.paused; }
  setPaused(paused: boolean): void { this.paused = paused; if (paused) void this.interrupt('queued', 'harness paused'); else this.pump(); }

  /** Feed every body execution receipt seen in host events. */
  observeExecution(exec: { id: string; phase: string; terminal: boolean } | undefined): void {
    if (!exec?.terminal) return;
    this.seenTerminal.set(exec.id, exec.phase);
    if (this.seenTerminal.size > 200) this.seenTerminal.delete(this.seenTerminal.keys().next().value!);
    this.waiters.get(exec.id)?.(exec.phase);
  }

  /** Stop the running intent (if it is `intentId` or any when omitted) and move it to `to`. */
  async interrupt(to: 'queued' | 'paused' | 'cancelled' | 'failed', reason: string, intentId?: string): Promise<void> {
    const r = this.running;
    if (!r || (intentId && r.intentId !== intentId)) return;
    this.running = null;
    r.controller.abort(new Error(reason));
    const intent = this.intents.ref(r.intentId);
    if (intent?.state === 'active') this.intents.transition(r.intentId, to, { reason });
    await this.stopBody();
    // Do not await r.done: a body call that ignores its signal must not wedge the harness.
    this.pump();
  }

  /** Consider preemption after a new submission. */
  maybePreempt(candidate: Intent): void {
    const active = this.intents.active();
    if (active && candidate.priority >= URGENT && candidate.priority > active.priority)
      void this.interrupt('queued', `preempted by urgent intent ${candidate.id}`, active.id);
    else this.pump();
  }

  pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    queueMicrotask(() => {
      this.pumping = false;
      if (this.paused || !this.body || this.running) return;
      const next = this.intents.next(); if (!next) return;
      const controller = new AbortController();
      this.intents.transition(next.id, 'active', { reason: null, attempts: next.attempts + 1 });
      const run: Running = { intentId: next.id, controller, done: Promise.resolve() };
      run.done = this.execute(next.id, controller.signal).catch(error => {
        if (controller.signal.aborted) return;
        const intent = this.intents.ref(next.id);
        if (intent?.state === 'active') this.intents.transition(next.id, 'failed', { reason: String((error as Error).message ?? error).slice(0, 300) });
      }).finally(() => { if (this.running === run) { this.running = null; this.pump(); } });
      this.running = run;
    });
  }

  private async execute(id: string, signal: AbortSignal): Promise<void> {
    const intent = this.intents.ref(id)!;
    const deadline = typeof intent.constraints.deadlineMs === 'number' && intent.startedAt
      ? Date.parse(intent.startedAt) + intent.constraints.deadlineMs : Infinity;
    if (!intent.plan) {
      const planned = await this.planner.plan(structuredClone(intent), this.context);
      if (signal.aborted) return;
      if ('needsHost' in planned) { this.intents.transition(id, 'paused', { reason: planned.needsHost }); return; }
      this.intents.transition(id, 'active', { plan: planned.steps, stepIndex: 0 });
    }
    const results: string[] = [];
    for (let i = intent.stepIndex; i < intent.plan!.length; i++) {
      if (signal.aborted) return;
      if (Date.now() > deadline) throw new Error('deadline exceeded');
      const step = intent.plan![i]!;
      const outcome: BodyOutcome = await this.body!.call(step.tool, step.args, signal);
      if (signal.aborted) return;
      if (outcome.failed) throw new Error(`step ${i + 1} ${step.tool} failed: ${outcome.text.slice(0, 200)}`);
      let phase = 'completed';
      if (outcome.execution && !outcome.execution.terminal) phase = await this.waitTerminal(outcome.execution.id, signal, deadline);
      else if (outcome.execution) phase = outcome.execution.phase;
      if (signal.aborted) return;
      if (phase !== 'completed') throw new Error(`step ${i + 1} ${step.tool} ended ${phase}`);
      results.push(outcome.text.slice(0, 120));
      this.intents.transition(id, 'active', { stepIndex: i + 1, reason: `step ${i + 1}/${intent.plan!.length} done` });
    }
    this.intents.transition(id, 'done', { result: results.join(' | ').slice(0, 500) || 'done' });
  }

  private waitTerminal(executionId: string, signal: AbortSignal, deadline: number): Promise<string> {
    const seen = this.seenTerminal.get(executionId);
    if (seen) return Promise.resolve(seen);
    const timeout = Math.min(this.options.stepTimeoutMs ?? 600_000, Math.max(0, deadline - Date.now()));
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); this.waiters.delete(executionId); signal.removeEventListener('abort', onAbort); };
      const onAbort = () => { cleanup(); resolve('aborted'); };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`body task ${executionId} timed out`)); }, timeout);
      this.waiters.set(executionId, phase => { cleanup(); resolve(phase); });
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private async stopBody(): Promise<void> {
    const tool = this.options.stopTool ?? 'mc_stop';
    if (!this.body || !tool) return;
    try { await this.body.call(tool, {}, AbortSignal.timeout(10_000)); }
    catch (error) { this.options.log?.('stop tool failed', { error: String(error).slice(0, 200) }); }
  }

  async close(): Promise<void> { await this.interrupt('queued', 'harness stopped'); this.body = null; }
}
