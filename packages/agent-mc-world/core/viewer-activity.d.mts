/** Shared viewer's validated, bounded presentation record. */
export interface AgentActivityRecord {
  schema: 'agent-activity/v1'; id: string; at: string;
  kind: 'reasoning' | 'message' | 'tool' | 'execution' | 'decision' | 'phase';
  source: 'system1' | 'system2' | 'human' | 'unknown';
  status: 'started' | 'accepted' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown';
  title: string; text?: string; arguments?: unknown; result?: unknown;
  run?: string; session?: string; round?: number; callId?: string; taskId?: string; tool?: string; model?: string; durationMs?: number;
}
export function normalizeAgentActivity(value: unknown): AgentActivityRecord | null;
export class AgentActivityHistory {
  constructor(options?: { limit?: number; bytes?: number });
  put(value: unknown): boolean;
  snapshot(): AgentActivityRecord[];
  clear(): void;
}
