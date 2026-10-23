/** Literal terminal evidence for request indexes; the caller selects realm and retains originals. */
import type { ExecutionPhase, ExecutionReceipt } from '../contracts/protocol.ts';

export interface ContextExecutionSource {
  source: string; ts: string; text: string; run?: string; cursor?: number; execution?: unknown;
}
export interface ContextExecutionReading {
  source: string; at: string; run?: string; cursor?: number;
  id: string; kind: ExecutionReceipt['kind']; phase: ExecutionPhase; terminal: true; goalCompleted: boolean | null;
  steps: Array<{ step: number; outcome: string; skill?: string; reason: { text: string; chars: number; truncated: boolean; kind: 'detail' | 'preview' } | null;
    changed?: Record<string, boolean | null> }>;
  omittedSteps: number;
  receipt?: { text: string; chars: number; truncated: boolean };
}
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : null;
const terminalPhases = new Set<ExecutionPhase>(['completed', 'partial', 'blocked', 'cancelled', 'superseded', 'rejected']);

/** Acceptance and unstructured text cannot create a terminal. No action, acknowledgement or goal judgement. */
export function contextExecutionReading(source: ContextExecutionSource, previewChars = 480): ContextExecutionReading | null {
  if (!Number.isSafeInteger(previewChars) || previewChars < 0) throw new TypeError('previewChars must be a non-negative safe integer');
  const execution = object(source.execution);
  if (!execution || execution.terminal !== true || typeof execution.id !== 'string' || !execution.id
    || !['task', 'method', 'observation'].includes(String(execution.kind)) || !terminalPhases.has(execution.phase as ExecutionPhase)
    || !source.source || !Number.isFinite(Date.parse(source.ts))) return null;
  const evidence = object(execution.evidence);
  const original = Array.isArray(evidence?.steps) ? evidence.steps.flatMap(value => {
    const row = object(value);
    return row && Number.isSafeInteger(row.step) && Number(row.step) > 0
      && ['ok', 'noop', 'partial', 'fail', 'skip', 'cut'].includes(String(row.outcome)) ? [row] : [];
  }) : [];
  const selected = original.filter(row => !['ok', 'noop'].includes(String(row.outcome))).slice(-4);
  const steps = selected.map(row => {
    const detail = object(row.detail), effect = object(row.observedEffect), changed = object(effect?.changed);
    const body = typeof detail?.text === 'string' ? detail.text : typeof row.why === 'string' ? row.why : null;
    const chars = detail && Number.isSafeInteger(detail.chars) && Number(detail.chars) >= (body?.length ?? 0) ? Number(detail.chars) : body?.length ?? 0;
    return { step: Number(row.step), outcome: String(row.outcome), ...(typeof effect?.skill === 'string' ? { skill: effect.skill } : {}),
      reason: body === null ? null : { text: body.slice(0, previewChars), chars,
        truncated: detail?.truncated === true || body.length > previewChars, kind: detail ? 'detail' as const : 'preview' as const },
      ...(changed ? { changed: Object.fromEntries(['target', 'inventory', 'position', 'window'].map(key => [key,
        typeof changed[key] === 'boolean' ? changed[key] : null])) } : {}) };
  });
  return { source: source.source, at: source.ts, ...(source.run ? { run: source.run } : {}),
    ...(Number.isSafeInteger(source.cursor) ? { cursor: source.cursor } : {}), id: execution.id,
    kind: execution.kind as ExecutionReceipt['kind'], phase: execution.phase as ExecutionPhase, terminal: true,
    goalCompleted: typeof execution.goalCompleted === 'boolean' ? execution.goalCompleted : null,
    steps, omittedSteps: original.length - selected.length,
    ...(steps.length && steps.every(step => step.reason?.kind === 'detail') ? {} : {
      receipt: { text: source.text.slice(0, previewChars), chars: source.text.length, truncated: source.text.length > previewChars } }) };
}
