import type { ProcedureGraph } from './procedure.ts';
export interface ProcedureScope { invocation: number; revision: string; parent?: number }
export function procedureProgram(graph: ProcedureGraph, options: {
  capabilities(scope: ProcedureScope): Record<string, unknown>;
  onInvocation(event: ProcedureScope & { status: 'running' | 'completed' | 'failed'; error?: string }): void;
  maxInvocations: number;
}): { validate(): { valid: true; versions: number }; run(params: Record<string, unknown>): Promise<unknown> };
