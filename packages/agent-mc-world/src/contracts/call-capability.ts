import { Ajv, type ValidateFunction } from 'ajv';
import type { ToolDef } from './host.ts';

export const CALL_CAPABILITY_SCHEMA = 'agent-mc/call-capability/v1' as const;
export interface CallCapability {
  schema: typeof CALL_CAPABILITY_SCHEMA;
  tool: string;
  valid: boolean;
  available: boolean | null;
  readOnly: boolean | null;
  backgroundLearning: boolean | null;
  reason: 'declared' | 'unknown_tool' | 'invalid_arguments' | 'classification_unavailable';
  /** Classification is neither execution nor a lease/authorization to execute later. */
  dispatched: false;
}
const ajv = new Ajv({ strict: false, allErrors: false, validateFormats: false });
const validators = new WeakMap<object, ValidateFunction>();

/** Pure inspection of the same schema and argument predicates used by SDK hosts.
 * No handler, body queue, connection, model or adoption is invoked. Predicates must
 * remain side-effect-free; their failure is unknown, never a permissive fallback.
 */
export function inspectToolCall(tool: ToolDef | undefined, name: string, args: unknown): CallCapability {
  const result: CallCapability = { schema: CALL_CAPABILITY_SCHEMA, tool: name, valid: false,
    available: null, readOnly: null, backgroundLearning: null, reason: 'unknown_tool', dispatched: false };
  if (!tool) return result;
  try {
    let validate = validators.get(tool.parameters);
    if (!validate) { validate = ajv.compile(tool.parameters); validators.set(tool.parameters, validate); }
    if (!args || typeof args !== 'object' || Array.isArray(args) || !validate(args))
      return { ...result, reason: 'invalid_arguments' };
    result.valid = true;
    const readOnly = tool.readOnlyCall
      ? tool.readOnlyCall(structuredClone(args) as Record<string, unknown>)
      : tool.tags.includes('read') && !tool.tags.some(tag => ['write', 'act', 'speak', 'flow'].includes(tag));
    const backgroundLearning = tool.learningCall?.(structuredClone(args) as Record<string, unknown>) ?? false;
    const available = tool.runtimeAvailable?.() ?? null;
    if (typeof readOnly !== 'boolean' || typeof backgroundLearning !== 'boolean'
      || (available !== null && typeof available !== 'boolean')) throw new Error('Invalid capability predicate');
    return { ...result, reason: 'declared', available, readOnly, backgroundLearning };
  } catch {
    return { ...result, reason: 'classification_unavailable' };
  }
}
