import { createHash } from 'node:crypto';
import type { WorldRequestFacts } from '../contracts/host.ts';
import type { FactPart } from '../contracts/protocol.ts';

export interface ExecutionFeedbackContext {
  protocol: 'execution-feedback-context/v1';
  kind: 'server-message' | 'host-decision';
  originalSha256: string;
}

const digest = (text: string) => createHash('sha256').update(text).digest('hex');

/** Only the producer may mark feedback after validating its server or host-decision provenance. */
export function executionFeedbackContext(original: string, kind: ExecutionFeedbackContext['kind'] = 'server-message'): ExecutionFeedbackContext {
  return { protocol: 'execution-feedback-context/v1', kind, originalSha256: digest(original) };
}

/** Match the source-owned marker to the text. Hosts must also validate the event source. */
export function hasExecutionFeedbackContext(original: string, value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const context = value as Partial<ExecutionFeedbackContext>;
  return context.protocol === 'execution-feedback-context/v1' && ['server-message', 'host-decision'].includes(context.kind ?? '')
    && context.originalSha256 === digest(original);
}

/** Stable, transitive source-owned fact selection. Cycles never duplicate facts. */
export function executionFactKeys(
  facts: Pick<WorldRequestFacts, 'executionPartKeys' | 'partDependencies'> | null | undefined,
  requested: readonly string[], ownsBody: boolean,
): string[] {
  const keys = [...new Set([...requested, ...(ownsBody ? facts?.executionPartKeys ?? [] : [])])];
  const seen = new Set(keys);
  for (let index = 0; index < keys.length; index++) {
    for (const key of facts?.partDependencies?.[keys[index]] ?? []) {
      if (!seen.has(key)) { seen.add(key); keys.push(key); }
    }
  }
  return keys;
}

/** Source-declared execution state accompanies a body owner even when its optional focus is narrow. */
export function executionFactParts(
  facts: Pick<WorldRequestFacts, 'parts' | 'executionPartKeys' | 'partDependencies'> | null | undefined,
  requested: readonly string[],
  ownsBody: boolean,
): FactPart[] {
  const keys = executionFactKeys(facts, requested, ownsBody);
  return keys.map(key => {
    const part = facts?.parts?.find(row => row.key === key);
    return part ? { ...part } : { key, text: '[当前分区不可用；旧值不作现场]' };
  });
}
