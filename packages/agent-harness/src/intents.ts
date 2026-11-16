import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { TERMINAL_STATES, type Intent, type IntentInput, type IntentPatch, type IntentState, type PriorityInput } from './types.ts';

const NAMED: Record<string, number> = { low: 20, normal: 50, high: 75, urgent: 95 };
export const URGENT = 90;

export function normalizePriority(p: PriorityInput | undefined): number {
  if (p === undefined) return 50;
  const n = typeof p === 'number' ? p : NAMED[p];
  if (n === undefined || !Number.isFinite(n)) throw new Error(`Invalid priority: ${String(p)}`);
  return Math.max(0, Math.min(100, Math.round(n)));
}

const ALLOWED: Record<IntentState, readonly IntentState[]> = {
  queued: ['active', 'paused', 'cancelled'],
  active: ['done', 'failed', 'paused', 'queued', 'cancelled'],
  paused: ['queued', 'cancelled'],
  done: [], cancelled: [], failed: [],
};

export type IntentListener = (intent: Intent, from: IntentState | null) => void;

/**
 * Intent queue and state machine. One intent is `active` at a time (the body is exclusive).
 * Optional JSON persistence; on reload an interrupted `active` intent returns to `queued`.
 */
export class IntentManager {
  private readonly intents = new Map<string, Intent>();
  private readonly listeners = new Set<IntentListener>();
  constructor(private readonly options: { file?: string; now?: () => Date; maxRetained?: number } = {}) {
    if (options.file) this.load(options.file);
  }

  private now(): string { return (this.options.now?.() ?? new Date()).toISOString(); }
  onChange(listener: IntentListener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  submit(input: IntentInput): Intent {
    const goal = typeof input.goal === 'string' ? input.goal.trim() : '';
    if (!goal || goal.length > 500) throw new Error('goal is required (≤500 chars)');
    const at = this.now();
    const intent: Intent = { id: `int_${randomUUID()}`, goal, priority: normalizePriority(input.priority),
      constraints: structuredClone(input.constraints ?? {}), hostRef: input.hostRef ?? null, state: 'queued', reason: null,
      createdAt: at, updatedAt: at, startedAt: null, endedAt: null, plan: null, stepIndex: 0, attempts: 0, result: null };
    this.intents.set(intent.id, intent);
    this.changed(intent, null);
    return intent;
  }

  get(id: string): Intent | null { const i = this.intents.get(id); return i ? structuredClone(i) : null; }
  /** @internal mutable access for the executor. */
  ref(id: string): Intent | undefined { return this.intents.get(id); }

  list(options: { states?: IntentState[]; limit?: number } = {}): Intent[] {
    return [...this.intents.values()].filter(i => !options.states || options.states.includes(i.state))
      .sort((a, b) => order(a) - order(b) || b.priority - a.priority || a.createdAt.localeCompare(b.createdAt))
      .slice(0, options.limit ?? 50).map(i => structuredClone(i));
  }
  active(): Intent | null { return [...this.intents.values()].find(i => i.state === 'active') ?? null; }
  next(): Intent | null {
    return [...this.intents.values()].filter(i => i.state === 'queued')
      .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt))[0] ?? null;
  }

  transition(id: string, to: IntentState, changes: Partial<Pick<Intent, 'reason' | 'result' | 'plan' | 'stepIndex' | 'attempts'>> = {}): Intent {
    const intent = this.intents.get(id);
    if (!intent) throw new Error(`Unknown intent ${id}`);
    const from = intent.state;
    if (from !== to && !ALLOWED[from].includes(to)) throw new Error(`Intent ${id} cannot go from ${from} to ${to}`);
    if (to === 'active' && from !== 'active' && this.active()) throw new Error('Another intent is already active');
    const at = this.now();
    Object.assign(intent, changes, { state: to, updatedAt: at });
    if (to === 'active' && !intent.startedAt) intent.startedAt = at;
    if (TERMINAL_STATES.includes(to)) intent.endedAt = at;
    this.changed(intent, from);
    return structuredClone(intent);
  }

  update(id: string, patch: IntentPatch): Intent {
    const intent = this.intents.get(id);
    if (!intent) throw new Error(`Unknown intent ${id}`);
    if (TERMINAL_STATES.includes(intent.state)) throw new Error(`Intent ${id} is ${intent.state}`);
    if (intent.state === 'active' && (patch.goal !== undefined || patch.constraints !== undefined))
      throw new Error('Pause the active intent before changing its goal or constraints');
    if (patch.goal !== undefined) {
      const goal = patch.goal.trim(); if (!goal || goal.length > 500) throw new Error('goal is required (≤500 chars)');
      intent.goal = goal;
    }
    if (patch.priority !== undefined) intent.priority = normalizePriority(patch.priority);
    if (patch.constraints !== undefined) { intent.constraints = structuredClone(patch.constraints); intent.plan = null; intent.stepIndex = 0; }
    intent.updatedAt = this.now();
    this.changed(intent, intent.state);
    return structuredClone(intent);
  }

  private changed(intent: Intent, from: IntentState | null): void {
    this.prune();
    this.save();
    for (const l of this.listeners) { try { l(structuredClone(intent), from); } catch { /* isolated */ } }
  }

  private prune(): void {
    const max = this.options.maxRetained ?? 200;
    const ended = [...this.intents.values()].filter(i => TERMINAL_STATES.includes(i.state)).sort((a, b) => (a.endedAt ?? '').localeCompare(b.endedAt ?? ''));
    while (this.intents.size > max && ended.length) this.intents.delete(ended.shift()!.id);
  }

  private save(): void {
    const file = this.options.file; if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ protocol: 'agent-mc-harness/intents/v1', intents: [...this.intents.values()] }, null, 1));
    renameSync(tmp, file);
  }

  private load(file: string): void {
    let raw: string;
    try { raw = readFileSync(file, 'utf8'); } catch { return; }
    const parsed = JSON.parse(raw) as { intents?: Intent[] };
    for (const i of parsed.intents ?? []) {
      if (i.state === 'active') { i.state = 'queued'; i.reason = 'interrupted by restart'; }
      this.intents.set(i.id, i);
    }
  }
}

function order(i: Intent): number { return { active: 0, paused: 1, queued: 2, done: 3, failed: 3, cancelled: 3 }[i.state]; }
