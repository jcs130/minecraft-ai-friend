/** Wire contract. Additive v1 fields are optional; incompatible changes require a new version. */
export const PROTOCOL = 'agent-mc/v1' as const;
export type ProtocolVersion = typeof PROTOCOL;
export type ExecutionPhase = 'accepted' | 'validated' | 'running' | 'suspended' | 'completed' | 'partial' | 'blocked' | 'cancelled' | 'superseded' | 'rejected';
export interface ExecutionReceipt {
  kind: 'task' | 'method' | 'observation';
  id: string;
  phase: ExecutionPhase;
  terminal: boolean;
  /** Only the host can judge its goal; execution completion never makes this true. */
  goalCompleted: false;
  evidence?: Record<string, unknown>;
}
export interface CallOptions { requestId?: string; turnId?: string; signal?: AbortSignal }
export interface CallControl {
  protocol: ProtocolVersion;
  requestId: string;
  turnId?: string;
  barrierAfter: boolean;
  endTurnRequested: boolean;
  /** RPC completion is not a decision boundary. */
  turnEnded: false;
}
export interface TurnReceipt { protocol: ProtocolVersion; id: string; phase: 'open' | 'ended'; round: number }
export interface ArchiveQuery {
  run?: string;
  after?: number;
  limit?: number;
  type?: string;
  keyword?: string;
}
export interface CurrentFact { key: string; text: string; revision: string; original: string }
export interface ContextBudget { contextTokens: number; reservedOutputTokens: number }
export interface PreparedContext {
  protocol: ProtocolVersion;
  prefix: string;
  tail: CurrentFact[];
  omittedKeys: string[];
  usage: { prefix: number; history: number; tools: number; facts: number; reservedOutput: number; total: number; counter: string };
}
export function requireProtocol(version: string): asserts version is ProtocolVersion {
  if (version !== PROTOCOL) throw new Error(`Unsupported protocol ${version}; supported: ${PROTOCOL}`);
}
