import type { ErrorObject } from 'ajv';
/** API errors only. World refusals belong in execution/business receipts. */
export function argumentDiagnostics(errors: readonly ErrorObject[] | null | undefined, problem: string, prefix = '') {
  const leaves = (errors ?? []).filter(e => !['anyOf','oneOf','if'].includes(e.keyword));
  return (leaves.length ? leaves : errors ?? []).slice(0,4).map(e => ({
    path: prefix + e.instancePath + (e.keyword === 'required' ? `/${e.params.missingProperty}`
      : e.keyword === 'additionalProperties' ? `/${e.params.additionalProperty}` : ''),
    expected: { rule: e.keyword, ...e.params }, problem: e.message ?? problem,
  }));
}
export function invalidToolArguments(name: string, errors: readonly ErrorObject[] | null | undefined,
  schema: Record<string,unknown>, problem = 'Invalid arguments') {
  return { status: 'invalid_arguments', reason: 'schema_validation', message: `Invalid arguments: ${problem}`, completed: 0, remaining: null,
    retryable: false, retry_after: null, next_safe_read: null, executed: false,
    errors: argumentDiagnostics(errors, problem), tool: name,
    minimal_legal_example: Array.isArray(schema.examples) ? schema.examples[0] ?? null : null };
}
