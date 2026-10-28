import { createHash } from 'node:crypto';
import type { ExecutionReceipt } from '../contracts/protocol.ts';

export type ExecutionIdentity = Pick<ExecutionReceipt, 'kind' | 'id' | 'phase' | 'terminal' | 'goalCompleted'>;
export interface RuntimeExecutionState {
  protocol: 'agent-mc-execution-state/v1';
  scope: 'runtime-receipts';
  run: string;
  generation: number;
  phase: string;
  revision: string;
  /** Exact counts, with bounded identity previews. They do not assert overall body/goal idleness. */
  activeCount: number;
  active: ExecutionIdentity[];
  detachedCount: number;
  detached: ExecutionIdentity[];
  latestTerminal: ExecutionIdentity | null;
  previousRuns: 'not-covered';
}

/** No inferred completion, cancellation or replay. Old-generation unresolved work remains explicit. */
export function runtimeExecutionState(run: string, generation: number, phase: string,
  entries: readonly { generation: number; receipt: ExecutionReceipt }[]): RuntimeExecutionState {
  const identity = (r: ExecutionReceipt): ExecutionIdentity => ({kind:r.kind,id:r.id,phase:r.phase,
    terminal:r.terminal,goalCompleted:r.goalCompleted});
  const active=entries.filter(x=>x.generation===generation&&!x.receipt.terminal).map(x=>identity(x.receipt));
  const detached=entries.filter(x=>x.generation!==generation&&!x.receipt.terminal).map(x=>identity(x.receipt));
  const terminals=entries.filter(x=>x.generation===generation&&x.receipt.terminal);
  const latestTerminal=terminals.length?identity(terminals.at(-1)!.receipt):null;
  // Cursor/clock/chat changes never masquerade as execution progress. Include
  // every identity in the digest even when only a bounded preview is presented.
  const revision=createHash('sha256').update(JSON.stringify({run,generation,phase,active,detached,latestTerminal})).digest('hex');
  return {protocol:'agent-mc-execution-state/v1',scope:'runtime-receipts',run,generation,phase,revision,
    activeCount:active.length,active:active.slice(-3),detachedCount:detached.length,detached:detached.slice(-3),
    latestTerminal,previousRuns:'not-covered'};
}
