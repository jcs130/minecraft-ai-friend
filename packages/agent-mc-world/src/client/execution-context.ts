import { createHash } from 'node:crypto';
import type { WorldRequestFacts } from '../contracts/host.ts';
import type { FactPart } from '../contracts/protocol.ts';

export interface ExecutionFeedbackContext {
  protocol: 'execution-feedback-context/v1';
  kind: 'server-message';
  originalSha256: string;
}

const digest = (text: string) => createHash('sha256').update(text).digest('hex');

/** Only the producer may mark a message after validating its native server provenance. */
export function executionFeedbackContext(original: string): ExecutionFeedbackContext {
  return { protocol: 'execution-feedback-context/v1', kind: 'server-message', originalSha256: digest(original) };
}

/** Match the source-owned marker to the text. Hosts must also validate the event source. */
export function hasExecutionFeedbackContext(original: string, value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const context = value as Partial<ExecutionFeedbackContext>;
  return context.protocol === 'execution-feedback-context/v1' && context.kind === 'server-message'
    && context.originalSha256 === digest(original);
}

/** Source-declared execution state accompanies a body owner even when its optional focus is narrow. */
export function executionFactParts(
  facts: Pick<WorldRequestFacts, 'parts' | 'executionPartKeys'> | null | undefined,
  requested: readonly string[],
  ownsBody: boolean,
): FactPart[] {
  const keys = [...new Set([...requested, ...(ownsBody ? facts?.executionPartKeys ?? [] : [])])];
  return keys.map(key => {
    const part = facts?.parts?.find(row => row.key === key);
    return part ? { ...part } : { key, text: '[当前分区不可用；旧值不作现场]' };
  });
}
