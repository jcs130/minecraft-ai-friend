import { METHOD_LIMITS } from './method-runner.ts';
import { procedureReference, type ProcedureReference } from './support/procedure.ts';

export interface CombatRoutine {
  id: string;
  intent: string;
  procedure: ProcedureReference;
  params?: Record<string, unknown>;
  durationMs?: number;
}

export const COMBAT_ROUTINES_SCHEMA = { type: 'array', maxItems: 16, items: {
  type: 'object', additionalProperties: false, required: ['id', 'intent', 'procedure'], properties: {
    id: { type: 'string', pattern: '^[a-z][a-z0-9_:-]{0,63}$' },
    intent: { type: 'string', minLength: 1, maxLength: 240 },
    procedure: { type: 'object', additionalProperties: false, required: ['handle', 'revision'], properties: {
      handle: { type: 'string', pattern: '^mem:mc-method/[a-z][a-z0-9-]{0,63}/[a-f0-9]{64}$' },
      revision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    } },
    params: { type: 'object' },
    durationMs: { type: 'integer', minimum: 1000, maximum: METHOD_LIMITS.maxDurationMs },
  },
} };

export function validCombatRoutines(value: unknown): value is CombatRoutine[] {
  if (!Array.isArray(value) || value.length > 16) return false;
  const ids = new Set<string>();
  return value.every(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || Object.keys(row).some(key => !['id', 'intent', 'procedure', 'params', 'durationMs'].includes(key))
      || typeof row.id !== 'string' || !/^[a-z][a-z0-9_:-]{0,63}$/.test(row.id) || ids.has(row.id)
      || typeof row.intent !== 'string' || !row.intent.trim() || row.intent.length > 240
      || row.durationMs !== undefined && (!Number.isInteger(row.durationMs)
        || row.durationMs < 1000 || row.durationMs > METHOD_LIMITS.maxDurationMs)) return false;
    ids.add(row.id);
    try {
      const reference = procedureReference(row.procedure);
      const match = /^mem:mc-method\/[a-z][a-z0-9-]{0,63}\/([a-f0-9]{64})$/.exec(reference.handle);
      if (!match || match[1] !== reference.revision) return false;
      return row.params === undefined || !!row.params && typeof row.params === 'object' && !Array.isArray(row.params)
        && JSON.stringify(row.params).length <= METHOD_LIMITS.paramsChars;
    } catch { return false; }
  });
}
