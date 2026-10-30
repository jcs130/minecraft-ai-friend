/** Requested effects, not acceptance or evidence that the world changed. */
import { SCOUT_SKILL_NAMES, SKILL_NAMES } from './skills.ts';

export type MinecraftRequestKind = 'action' | 'speech' | 'read';
const names = new Set<string>(SKILL_NAMES), scout = new Set<string>(SCOUT_SKILL_NAMES);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function minecraftStepRequestKind(step: unknown): MinecraftRequestKind | null {
  if (!object(step) || typeof step.skill !== 'string' || !names.has(step.skill)) return null;
  if (step.skill === 'observe' || step.skill === 'probe' || step.dryRun === true && scout.has(step.skill)) return 'read';
  if (step.skill !== 'chat') return 'action';
  if (typeof step.text !== 'string' || !step.text.trim()) return null;
  const text = step.text.trimStart();
  return !text.startsWith('/') || /^\/(?:minecraft:)?(?:tell|msg|w)\s+\S+\s+\S/u.test(text) ? 'speech' : 'action';
}

export function minecraftRequestKinds(steps: unknown): { kinds: MinecraftRequestKind[]; unknown: number } | null {
  if (!Array.isArray(steps)) return null;
  const kinds = new Set<MinecraftRequestKind>(); let unknown = 0;
  for (const step of steps) { const kind = minecraftStepRequestKind(step); if (kind) kinds.add(kind); else unknown++; }
  return { kinds: [...kinds], unknown };
}

/** Preserve the executor's needs contract when a host rejects social text.
 * Plain speech has no item output; only explicit dependencies on a removed
 * step are cut transitively. Native parsing, permissions, queue mode and all
 * automatic material dependencies still belong to the original World handler.
 * This function neither submits nor retries a task.
 */
export function omitRejectedMinecraftSpeech(input: unknown, rejected: readonly number[]): {
  supported: true; steps: Record<string, unknown>[]; kept: number[]; omitted: number[]; dependent: number[];
} | { supported: false; reason: string } {
  if (!Array.isArray(input) || !rejected.length || input.some(step => !object(step) || !minecraftStepRequestKind(step))) {
    return { supported: false, reason: 'Unknown batch shape or step contract' };
  }
  const steps = input as Record<string, unknown>[], removed = new Set<number>();
  for (const index of rejected) {
    if (!Number.isInteger(index) || index < 0 || index >= steps.length || minecraftStepRequestKind(steps[index]) !== 'speech') {
      return { supported: false, reason: 'Only exact social-text steps can be omitted' };
    }
    removed.add(index);
  }
  const omitted = [...removed].sort((a, b) => a - b), dependent: number[] = [];
  for (let index = 0; index < steps.length; index++) {
    const needs = steps[index].needs;
    if (needs == null) continue;
    if (!Array.isArray(needs) || needs.some(n => !Number.isInteger(n) || n < 1 || n > index)) {
      return { supported: false, reason: 'Invalid explicit step dependency' };
    }
    if (!removed.has(index) && needs.some(n => removed.has(n - 1))) { removed.add(index); dependent.push(index); }
  }
  const kept = steps.map((_, index) => index).filter(index => !removed.has(index));
  const mapping = new Map(kept.map((index, next) => [index + 1, next + 1]));
  const remaining = kept.map(index => {
    const copy = structuredClone(steps[index]);
    if (Array.isArray(copy.needs)) copy.needs = copy.needs.map(n => mapping.get(n));
    return copy;
  });
  return { supported: true, steps: remaining, kept, omitted, dependent };
}

/** A host may start an explicitly requested body suffix while checking a leading
 * social utterance. Explicit queue ordering, speech dependencies/expectations,
 * interleaved commands and unknown shapes retain the original ordered batch.
 * Native validation, admission and cancellation still belong to the World.
 * This is a pure partition; it never submits work or authorizes an extra step. */
export function independentMinecraftSpeechPrefix(args: Readonly<Record<string, unknown>>): ReturnType<typeof omitRejectedMinecraftSpeech> {
  if (args.queue != null && args.queue !== 'replace') return { supported: false, reason: 'Explicit queue ordering must be retained' };
  if (!Array.isArray(args.steps)) return { supported: false, reason: 'No action batch' };
  const count = args.steps.findIndex(step => minecraftStepRequestKind(step) !== 'speech');
  if (count < 1 || count >= args.steps.length) return { supported: false, reason: 'No leading speech and body suffix' };
  if (args.steps.slice(count).some(step => minecraftStepRequestKind(step) === 'speech')) {
    return { supported: false, reason: 'Interleaved speech retains native order' };
  }
  if (args.steps.slice(0, count).some(step => step.expect != null || step.needs != null
    && (!Array.isArray(step.needs) || step.needs.length !== 0))) {
    return { supported: false, reason: 'Speech has an explicit execution dependency or expectation' };
  }
  const result = omitRejectedMinecraftSpeech(args.steps, Array.from({ length: count }, (_, index) => index));
  if (!result.supported) return result;
  if (result.dependent.length || !result.steps.some(step => minecraftStepRequestKind(step) === 'action')) {
    return { supported: false, reason: 'Body depends on speech or has no independent action' };
  }
  return result;
}
