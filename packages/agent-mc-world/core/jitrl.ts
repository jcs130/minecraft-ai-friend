/** JitRL-style, scope-bound episodic action advice. No model calls or body dispatch.
 * Paper: https://arxiv.org/abs/2601.18510 (v4, sec. 4 / appendix A).
 * This bounded first integration uses one measured action segment per return.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { GameMemoryContext, GameMemoryScope } from './game-memory.ts';
import { experienceHash, operationActionHash, operationScopeKey, operationObservation, type OperationObservation, type OperationExperience } from './operation-experience.ts';

export type JitRlCandidate = { id: string; actionHash: string; prior: number; ready: boolean };
export type JitRlNeighbour = { id: string; actionHash: string; value: number };

/** The adjustment is to log probabilities, never to raw probability scores. */
export function reweightJitRl(candidates: readonly JitRlCandidate[], neighbours: readonly JitRlNeighbour[], beta = 0.5) {
  if (!Number.isFinite(beta) || beta < 0 || beta > 2) throw new Error('beta must be 0..2');
  if (!candidates.length || candidates.some(c => !Number.isFinite(c.prior) || c.prior < 0 || c.prior > 1)
      || new Set(candidates.map(c => c.id)).size !== candidates.length) throw new Error('Invalid candidate distribution');
  const ready = candidates.filter(c => c.ready);
  const total = ready.reduce((sum, c) => sum + c.prior, 0);
  if (!ready.length || total <= 0) throw new Error('No ready candidate with positive probability');
  const evidence = [...new Map(neighbours.map(n => [n.id, n])).values()].filter(n => Number.isFinite(n.value)
    && n.value >= -1 && n.value <= 1 && ready.some(c => c.actionHash === n.actionHash));
  const baseline = evidence.length ? evidence.reduce((sum, n) => sum + n.value, 0) / evidence.length : null;
  const rows = ready.map(c => {
    const matches = evidence.filter(n => n.actionHash === c.actionHash);
    const q = matches.length ? matches.reduce((sum, n) => sum + n.value, 0) / matches.length : null;
    return { ...c, prior: c.prior / total, samples: matches.length, q, advantage: q === null || baseline === null ? 0 : q - baseline };
  });
  // Do not force optimistic exploration or amplify a single unopposed action's evidence.
  const scale = Math.max(0, ...rows.map(c => Math.abs(c.advantage)));
  const logits = rows.map(c => c.prior === 0 ? -Infinity : Math.log(c.prior) + beta * (scale ? c.advantage / scale : 0));
  const max = Math.max(...logits), weights = logits.map(l => Math.exp(l - max)), sum = weights.reduce((a, b) => a + b, 0);
  return { baseline, sampleSize: evidence.length, candidates: rows.map((c, i) => ({ ...c, posterior: weights[i]! / sum })) };
}

type Criterion = { kind: 'food' | 'health' | 'inventory' | 'distance'; target: number; item?: string; destination?: [number, number, number] };
type State = { dimension: string; taskKey: string; phase: string; health: number; food: number;
  position: [number, number, number]; inventoryHash: string; conditionHash: string };
type Decision = { schema: 'agent-mc-jitrl/v1'; id: string; scopeKey: string; inputHash: string; at: string; expiresAt: string;
  state: State; criterion: Criterion; candidates: JitRlCandidate[]; result: Record<string, unknown> };
type Feedback = { schema: 'agent-mc-jitrl-feedback/v1'; id: string; decisionId: string; candidateId: string; actionHash: string;
  experienceId: string;
  scopeKey: string; at: string; observedAt: string; state: State; criterion: Criterion; value: number | null;
  reason: string; goalVerified: false };
const MAX_RECENT = 1024, MAX_BYTES = 512_000, MAX_AGE_MS = 30 * 24 * 3600_000;
const obj = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function key(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,95}$/.test(value)) throw new Error(`${name}: use a stable metadata key (1..96 ASCII characters), not prose`);
  return value;
}
function only(value: Record<string, unknown>, fields: string[]) {
  for (const k of Object.keys(value)) if (!fields.includes(k)) throw new Error(`Unknown JitRL field: ${k}`);
}
function criterion(value: unknown): Criterion {
  if (!obj(value)) throw new Error('criterion is required');
  only(value, ['kind', 'target', 'item', 'destination']);
  const kind = value.kind;
  if (!['food', 'health', 'inventory', 'distance'].includes(String(kind)) || typeof value.target !== 'number'
      || !Number.isFinite(value.target) || value.target <= 0 || value.target > 10000) throw new Error('criterion requires kind and positive target delta, at most 10000');
  if (kind === 'inventory') return { kind, target: value.target, item: key(value.item, 'item') };
  if (kind === 'distance') {
    const p = value.destination;
    if (!Array.isArray(p) || p.length !== 3 || !p.every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 30_000_000)) throw new Error('distance requires a finite destination [x,y,z]');
    return { kind, target: value.target, destination: p as [number, number, number] };
  }
  if (value.item !== undefined || value.destination !== undefined) throw new Error('Unexpected criterion item/destination');
  return { kind: kind as 'food' | 'health', target: value.target };
}

function state(context: GameMemoryContext, input: Record<string, unknown>): State {
  const o = operationObservation(context.observation?.());
  if (!o?.dimension || !o.position || o.health === null || o.food === null || !o.inventory || o.dimension !== context.dimension)
    throw new Error('JitRL rank requires fresh, connected position/health/food/inventory and the current dimension');
  const conditions = input.conditions ?? {};
  if (!obj(conditions) || Object.keys(conditions).length > 12) throw new Error('conditions: at most 12 numeric/boolean metadata fields');
  for (const [k, v] of Object.entries(conditions)) {
    key(k, 'condition');
    if (!(v === null || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v))) throw new Error('conditions must be numbers, booleans or null');
  }
  return { dimension: o.dimension, taskKey: key(input.taskKey, 'taskKey'), phase: key(input.phase, 'phase'),
    health: o.health, food: o.food, position: [o.position.x, o.position.y, o.position.z],
    inventoryHash: experienceHash(o.inventory), conditionHash: experienceHash(conditions) };
}
function stateSimilarity(a: State, b: State): number | null {
  if (a.dimension !== b.dimension || a.taskKey !== b.taskKey || a.phase !== b.phase || a.conditionHash !== b.conditionHash) return null;
  const distance = Math.hypot(...a.position.map((v, i) => v - b.position[i]!));
  if (distance > 16 || Math.abs(a.health - b.health) > 4 || Math.abs(a.food - b.food) > 4) return null;
  return distance / 16 + Math.abs(a.health - b.health) / 4 + Math.abs(a.food - b.food) / 4;
}
function measuredReturn(row: OperationExperience, c: Criterion): { value: number | null; reason: string } {
  const a = row.before, b = row.after;
  if (row.dispatch !== 'returned' || !row.execution?.terminal || !['completed', 'partial', 'blocked'].includes(row.execution.phase))
    return { value: null, reason: 'no-measurable-terminal' };
  if (!a || !b || !a.dimension || a.dimension !== b.dimension || a.health === null || b.health === null
      || Date.parse(b.at) < Date.parse(a.at)) return { value: null, reason: 'missing-or-cross-dimension-observation' };
  let delta: number | null = null;
  if (c.kind === 'food' && a.food !== null && b.food !== null) delta = b.food - a.food;
  if (c.kind === 'health') delta = b.health - a.health;
  if (c.kind === 'inventory' && a.inventory && b.inventory) delta = (b.inventory[c.item!] ?? 0) - (a.inventory[c.item!] ?? 0);
  if (c.kind === 'distance' && a.position && b.position) {
    const dist = (p: NonNullable<OperationObservation['position']>) => Math.hypot(p.x - c.destination![0], p.y - c.destination![1], p.z - c.destination![2]);
    delta = dist(a.position) - dist(b.position);
  }
  if (delta === null || !Number.isFinite(delta)) return { value: null, reason: 'missing-measurement' };
  if (b.health <= 0) return { value: -1, reason: 'observed-death' };
  // Local progress with an explicit health-loss penalty, never a goal-success label.
  const harm = c.kind === 'health' ? 0 : Math.max(0, a.health - b.health) / Math.max(1, a.health);
  return { value: Math.max(-1, Math.min(1, delta / c.target) - harm), reason: 'measured-step-delta' };
}

export class JitRlBook {
  constructor(private readonly directory: string, private readonly getExperience: (scope: GameMemoryScope, id: string) => OperationExperience) {}
  private folder(scope: GameMemoryScope) {
    if ([scope.realm, scope.account, scope.agent].some(v => typeof v !== 'string' || !v || v.length > 500)) throw new Error('Invalid game identity');
    return join(this.directory, 'jitrl', operationScopeKey(scope));
  }
  private read<T>(path: string): T {
    const text = readFileSync(path, 'utf8');
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('JitRL record exceeds budget');
    return JSON.parse(text) as T;
  }
  private write(path: string, value: unknown, immutable = false) {
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('JitRL record exceeds budget');
    mkdirSync(join(path, '..'), { recursive: true });
    if (immutable) { writeFileSync(path, text, { flag: 'wx', mode: 0o600 }); return; }
    const tmp = `${path}.${randomUUID()}.tmp`;
    try { writeFileSync(tmp, text, { flag: 'wx', mode: 0o600 }); renameSync(tmp, path); }
    finally { if (existsSync(tmp)) unlinkSync(tmp); }
  }
  private recent(scope: GameMemoryScope): Feedback[] {
    const path = join(this.folder(scope), 'recent.json');
    const ids = existsSync(path) ? this.read<string[]>(path) : [];
    if (!Array.isArray(ids) || ids.length > MAX_RECENT || ids.some(id => !/^[a-f0-9]{64}$/.test(id))) throw new Error('Invalid JitRL evidence index');
    return ids.map(id => this.read<Feedback>(join(this.folder(scope), `feedback-${id}.json`))).filter(r => r.scopeKey === operationScopeKey(scope));
  }
  help() { return { protocol: 'agent-mc-jitrl/v1', operations: {
    rank: 'action:experience,operation:rank,requestId:<stable call key>,input:{taskKey,phase,conditions?,criterion,candidates}. 2..12 candidates: {id,prior,ready,tool,args}. All priors sum to 1. Exact args are hashed, never stored; prefer versioned procedure references. Returns advisory baseChoice/suggestedChoice; no action.',
    feedback: 'action:experience,operation:feedback,input:{decisionId,candidateId,experienceId}. Use the exact selected candidate and operation meta.experience.id after its terminal. Same tool/args must match. Retry a pending feedback with the same IDs. Unknown returns stay null.',
    policy_status: 'Bounded local evidence counts and missing-return reasons. No accuracy or goal-success claim.' },
    criterion: { kinds: ['food', 'health', 'inventory', 'distance'], target: 'Positive expected delta; inventory also needs item, distance needs destination:[x,y,z]. Set before execution.' },
    semantics: 'One-step contextual JitRL. Return is measured delta/target minus health-loss penalty, clipped [-1,1]. Local progress is not goal completion or causal improvement. No optimistic exploration, new model calls or automatic body dispatch.',
    context: 'taskKey/phase are stable ASCII metadata keys. conditions contains up to 12 numeric/boolean/null facts about hazards, capabilities, terrain etc. Unknown stays null. Scope/dimension/conditions/action revisions must match; current candidates must be executable. Inventory is checked again when crediting execution, not treated as permanent task identity.',
    example: { action: 'experience', operation: 'rank', requestId: 'food-choice-1', input: { taskKey: 'food-recovery', phase: 'eat', conditions: { safe: true }, criterion: { kind: 'food', target: 4 }, candidates: [
      { id: 'bread', prior: 0.6, ready: true, tool: 'mc_do', args: { steps: [{ skill: 'eat', item: 'bread' }] } },
      { id: 'carrot', prior: 0.4, ready: true, tool: 'mc_do', args: { steps: [{ skill: 'eat', item: 'carrot' }] } },
    ] } }, note: 'Candidate tool/args are examples; read the actual action schema and check inventory/permissions before ranking. Probabilities are declared candidate priors, not calibrated success probabilities.' }; }
  execute(args: Record<string, unknown>, ctx: GameMemoryContext): Record<string, unknown> {
    only(args, ['action', 'operation', 'requestId', 'input']);
    const input = args.input ?? {};
    if (!obj(input)) throw new Error('JitRL input must be an object');
    if (args.operation === 'policy_help') return this.help();
    if (args.operation === 'policy_status') {
      only(input, []);
      const rows = this.recent(ctx.scope), valid = rows.filter(r => r.value !== null);
      return { protocol: 'agent-mc-jitrl/v1', window: `latest-${MAX_RECENT}-feedback`, samples: rows.length, validReturns: valid.length,
        unknownReturns: rows.length - valid.length, from: rows[0]?.observedAt ?? null, to: rows.at(-1)?.observedAt ?? null,
        goalSuccessRate: null, causalImprovement: null, bodyDispatches: 0, inferenceCalls: 0 };
    }
    if (args.operation === 'rank') return this.rank(args.requestId, input, ctx);
    if (args.operation === 'feedback') return this.feedback(input, ctx);
    throw new Error('Unknown JitRL operation');
  }
  private rank(requestId: unknown, input: Record<string, unknown>, ctx: GameMemoryContext): Record<string, unknown> {
    const started = performance.now();
    only(input, ['taskKey', 'phase', 'conditions', 'criterion', 'candidates']);
    if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 128) throw new Error('rank requires a stable requestId (at most 128 chars)');
    const c = criterion(input.criterion);
    if (!Array.isArray(input.candidates) || input.candidates.length < 2 || input.candidates.length > 12) throw new Error('rank requires 2..12 candidates');
    const candidates: JitRlCandidate[] = input.candidates.map(raw => {
      if (!obj(raw)) throw new Error('Invalid candidate');
      only(raw, ['id', 'prior', 'ready', 'tool', 'args']);
      if (!obj(raw.args) || JSON.stringify(raw.args).length > 16000 || typeof raw.ready !== 'boolean'
          || typeof raw.prior !== 'number' || !Number.isFinite(raw.prior) || raw.prior < 0 || raw.prior > 1) throw new Error('Invalid candidate args/prior/ready');
      return { id: key(raw.id, 'candidate id'), actionHash: operationActionHash(key(raw.tool, 'tool'), raw.args), prior: raw.prior, ready: raw.ready };
    });
    if (Math.abs(candidates.reduce((sum, v) => sum + v.prior, 0) - 1) > 0.02
        || new Set(candidates.map(v => v.actionHash)).size !== candidates.length) throw new Error('Distinct actions and complete probability mass are required');
    const inputHash = experienceHash([input.taskKey, input.phase, input.conditions ?? {}, c, candidates]);
    const id = experienceHash([operationScopeKey(ctx.scope), requestId]), path = join(this.folder(ctx.scope), `decision-${id}.json`);
    if (existsSync(path)) {
      const old = this.read<Decision>(path);
      if (old.inputHash !== inputHash) throw new Error('rank requestId conflict');
      let current: State | null = null;
      try { current = state(ctx, input); } catch { /* Historical retry cannot imply a currently usable scene. */ }
      const changed = !current || experienceHash(current) !== experienceHash(old.state);
      return { ...old.result, replayed: true, expired: changed || Date.now() > Date.parse(old.expiresAt),
        staleReason: changed ? 'current-state-changed-or-unavailable' : null };
    }
    const current = state(ctx, input), now = Date.now();
    const history = this.recent(ctx.scope);
    const matches = history.filter(r => r.value !== null && now - Date.parse(r.observedAt) <= MAX_AGE_MS
      && now >= Date.parse(r.observedAt) && experienceHash(r.criterion) === experienceHash(c))
      .map(r => ({ r, similarity: stateSimilarity(current, r.state) })).filter((r): r is { r: Feedback; similarity: number } => r.similarity !== null)
      .filter(({ r }) => candidates.some(c => c.ready && c.actionHash === r.actionHash))
      .sort((a, b) => a.similarity - b.similarity || b.r.observedAt.localeCompare(a.r.observedAt)).slice(0, 10);
    const ranked = reweightJitRl(candidates, matches.map(({ r }) => ({ id: r.id, actionHash: r.actionHash, value: r.value! })));
    const base = [...ranked.candidates].sort((a, b) => b.prior - a.prior)[0]!;
    const best = [...ranked.candidates].sort((a, b) => b.posterior - a.posterior)[0]!;
    const at = new Date(now).toISOString(), expiresAt = new Date(now + 30_000).toISOString();
    const result = { protocol: 'agent-mc-jitrl/v1', decisionId: id, at, expiresAt, expired: false, replayed: false,
      status: ranked.sampleSize ? 'historical-advice' : 'base-prior', baseChoice: base.id, suggestedChoice: best.id,
      changed: best.id !== base.id, ...ranked, evidenceIds: matches.map(({ r }) => r.id),
      priorSource: 'caller-declared-not-calibrated', inferenceCalls: 0, bodyDispatched: false, goalVerified: false };
    Object.assign(result, { scanned: history.length, computeMs: performance.now() - started });
    this.write(path, { schema: 'agent-mc-jitrl/v1', id, scopeKey: operationScopeKey(ctx.scope), inputHash, at, expiresAt,
      state: current, criterion: c, candidates, result } satisfies Decision, true);
    return result;
  }
  private feedback(input: Record<string, unknown>, ctx: GameMemoryContext): Record<string, unknown> {
    only(input, ['decisionId', 'candidateId', 'experienceId']);
    const { decisionId, experienceId } = input;
    if (![decisionId, experienceId].every(id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id))) throw new Error('Use exact decisionId and experienceId');
    const d = this.read<Decision>(join(this.folder(ctx.scope), `decision-${decisionId}.json`));
    if (d.scopeKey !== operationScopeKey(ctx.scope) || d.id !== decisionId) throw new Error('Decision identity mismatch');
    const c = d.candidates.find(c => c.id === input.candidateId);
    if (!c?.ready) throw new Error('Feedback requires an originally ready candidate');
    const row = this.getExperience(ctx.scope, String(experienceId));
    if (row.kind !== 'operation' || row.actionHash !== c.actionHash) throw new Error('Operation does not match the selected action and arguments');
    if (Date.parse(row.at) < Date.parse(d.at) || Date.parse(row.at) > Date.parse(d.expiresAt)) throw new Error('Operation was not dispatched within the decision validity window');
    if (!row.before || row.before.dimension !== d.state.dimension || !row.before.position
      || Math.hypot(row.before.position.x - d.state.position[0], row.before.position.y - d.state.position[1], row.before.position.z - d.state.position[2]) > 4
      || row.before.health !== d.state.health || row.before.food !== d.state.food || experienceHash(row.before.inventory) !== d.state.inventoryHash)
      throw new Error('Pre-execution state changed; do not credit this stale decision');
    if (!row.execution?.terminal && row.dispatch !== 'rejected') return { recorded: false, pending: true, value: null, reason: 'await-original-terminal', decisionId, experienceId };
    // Multiple request IDs referring to the same physical execution are one sample.
    const sampleId = experienceHash([d.scopeKey, row.run, row.execution?.kind ?? 'rejected', row.execution?.id ?? row.id]);
    const path = join(this.folder(ctx.scope), `feedback-${sampleId}.json`);
    const old = existsSync(path) ? this.read<Feedback>(path) : null;
    if (old && (old.decisionId !== decisionId || old.candidateId !== c.id)) throw new Error('Operation already credited to another decision/candidate');
    const record: Feedback = old ?? { schema: 'agent-mc-jitrl-feedback/v1', id: sampleId, experienceId: String(experienceId), decisionId: String(decisionId), candidateId: c.id,
      actionHash: c.actionHash, scopeKey: d.scopeKey, at: new Date().toISOString(), observedAt: row.after?.at ?? row.updatedAt,
      state: d.state, criterion: d.criterion, ...measuredReturn(row, d.criterion), goalVerified: false };
    if (!old) this.write(path, record, true);
    // Also repairs an interrupted index append, without counting a retry twice.
    const ids = this.recent(ctx.scope).map(r => r.id);
    if (!ids.includes(record.id)) this.write(join(this.folder(ctx.scope), 'recent.json'), [...ids, record.id].slice(-MAX_RECENT));
    return { recorded: true, deduplicated: !!old, decisionId, experienceId, value: record.value, reason: record.reason,
      memoryReference: `mc-jitrl:${record.id}`, goalVerified: false };
  }
}
