import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGoalPlan, type GoalPlan } from './goal-plan.ts';
import type { MinecraftGoal } from './world.ts';

export interface GoalCheckpointScope { realm: string; account: string; agent: string }
export interface GoalCheckpoint {
  schema: 'agent-mc-goals/v1';
  scope: GoalCheckpointScope;
  savedAt: number;
  goals: MinecraftGoal[];
}
const MAX_BYTES = 1024 * 1024;
const scopeKey = (scope: GoalCheckpointScope) => createHash('sha256')
  .update(JSON.stringify([scope.realm, scope.account, scope.agent])).digest('hex');
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Convert the internal normalized predicates back through the public parser.
 * Recovery must not invent a weaker predicate or reuse a stale observation. */
function planInput(plan: GoalPlan): unknown[] {
  return plan.steps.map(step => ({ do: step.do, judgment: step.judgment,
    verify: step.verify?.map(probe => {
      const value = structuredClone(probe) as unknown as Record<string, unknown>;
      for (const key of ['count', 'matched', 'equals']) {
        const compare = value[key] as { op?: string; n?: number } | null;
        if (compare && typeof compare === 'object') value[key] = `${compare.op}${compare.n}`;
      }
      // The normal form records omitted blueprint options as null; the public
      // input contract distinguishes omission from an explicitly invalid null.
      if (probe.source === 'blueprint') {
        if (probe.loaded === null) delete value.loaded;
        if (probe.matched === null) delete value.matched;
      }
      if ('region' in probe) {
        value.region = [probe.region.min, probe.region.max]; value.dimension = probe.region.dimension;
      }
      return value;
    }) ?? null,
  }));
}

export function createGoalCheckpoint(scope: GoalCheckpointScope, goals: readonly MinecraftGoal[], savedAt = Date.now()): GoalCheckpoint {
  const checkpoint: GoalCheckpoint = { schema: 'agent-mc-goals/v1', scope: { ...scope }, savedAt, goals: structuredClone([...goals]) };
  // Validate the same public boundary on both writes and reads.
  restoreGoalCheckpoint(checkpoint, scope);
  return checkpoint;
}

/** Restores only an intention projection. No task, movement, current inventory,
 * location or mechanical verification survives this boundary. Host judgments
 * retain their original note/time as historical claims, not independent proof. */
export function restoreGoalCheckpoint(value: unknown, scope: GoalCheckpointScope): MinecraftGoal[] {
  if (!scope || [scope.realm, scope.account, scope.agent].some(v => typeof v !== 'string' || !v)) throw Error('Invalid goal scope');
  if (!value || typeof value !== 'object' || Buffer.byteLength(JSON.stringify(value)) > MAX_BYTES) throw Error('Invalid goal checkpoint');
  const saved = value as GoalCheckpoint;
  if (saved.schema !== 'agent-mc-goals/v1' || !saved.scope || scopeKey(saved.scope) !== scopeKey(scope)
    || !finite(saved.savedAt) || !Array.isArray(saved.goals) || saved.goals.length > 5) throw Error('Goal checkpoint schema or scope mismatch');
  const slots = new Set<number>();
  return saved.goals.map(goal => {
    if (!goal || !Number.isInteger(goal.slot) || goal.slot < 1 || goal.slot > 5 || slots.has(goal.slot)
      || typeof goal.text !== 'string' || !goal.text.trim() || !finite(goal.at)
      || typeof goal.realTime !== 'string' || !Number.isFinite(Date.parse(goal.realTime))
      || (goal.day !== null && !finite(goal.day))
      || (goal.revision !== undefined && (!Number.isInteger(goal.revision) || goal.revision < 1))
      || !goal.plan || !Array.isArray(goal.plan.steps) || goal.plan.steps.length > 12) throw Error('Invalid goal checkpoint entry');
    slots.add(goal.slot);
    for (const key of ['kind', 'target', 'blueprint'] as const) {
      if (goal[key] != null && typeof goal[key] !== 'string') throw Error('Invalid goal checkpoint metadata');
    }
    const progress = goal.progress;
    if (progress != null && (!finite(progress.current) || progress.current < 0
      || (progress.total !== null && (!finite(progress.total) || progress.total < 0))
      || (progress.unit !== null && typeof progress.unit !== 'string'))) throw Error('Invalid goal progress');
    const plan = parseGoalPlan(planInput(goal.plan));
    if ('error' in plan) throw Error(`Invalid checkpoint plan: ${plan.error}`);
    plan.steps.forEach((step, i) => {
      const previous = goal.plan.steps[i];
      if (step.judgment && previous.state === 'judged' && previous.evidence && 'note' in previous.evidence
        && typeof previous.evidence.note === 'string' && previous.evidence.note.trim()
        && finite(previous.evidence.judgedAt)) {
        step.state = 'judged';
        step.evidence = { note: previous.evidence.note, judgedAt: previous.evidence.judgedAt };
        step.completedAt = previous.evidence.judgedAt;
      }
    });
    return { slot: goal.slot, revision: goal.revision ?? 1, text: goal.text, kind: goal.kind ?? null,
      target: goal.target ?? null, blueprint: goal.blueprint ?? null, progress: progress ? { ...progress } : null,
      day: goal.day, realTime: goal.realTime, at: goal.at, plan, recoveredAt: saved.savedAt };
  });
}

/** Five-slot snapshots only, written on semantic mutations, never a transcript.
 * A corrupt existing file is kept intact until explicit storage clear/repair. */
export class GoalCheckpointBook {
  private readonly invalid = new Set<string>();
  private readonly memory = new Map<string,GoalCheckpoint>();
  constructor(private readonly directory: string | null) {}
  load(scope: GoalCheckpointScope): MinecraftGoal[] {
    if (!this.directory) {const saved=this.memory.get(scopeKey(scope));return saved?restoreGoalCheckpoint(saved,scope):[];}
    const key = scopeKey(scope), file = join(this.directory, `${key}.json`);
    try {
      if (statSync(file).size > MAX_BYTES) throw Error('Goal checkpoint exceeds size limit');
      return restoreGoalCheckpoint(JSON.parse(readFileSync(file, 'utf8')), scope);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      this.invalid.add(key); throw error;
    }
  }
  save(scope: GoalCheckpointScope, goals: readonly MinecraftGoal[]): void {
    const key = scopeKey(scope);
    if (this.invalid.has(key)) throw Error('Existing goal checkpoint is invalid; retained for explicit repair');
    const checkpoint=createGoalCheckpoint(scope, goals);
    if(!this.directory){this.memory.set(key,checkpoint);return;}
    const data = JSON.stringify(checkpoint);
    mkdirSync(this.directory, { recursive: true });
    const file = join(this.directory, `${key}.json`), temp = `${file}.${randomUUID()}.tmp`;
    try { writeFileSync(temp, data, { flag: 'wx', mode: 0o600 }); renameSync(temp, file); }
    finally { try { unlinkSync(temp); } catch { /* renamed or no temporary file */ } }
  }
  clear(): void {
    this.memory.clear();
    if (this.directory) {
      let names: string[];
      try { names = readdirSync(this.directory); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') names = []; else throw error; }
      for (const name of names) if (/^[a-f0-9]{64}\.json$/.test(name)) unlinkSync(join(this.directory, name));
    }
    this.invalid.clear();
  }
}
