/** Client-visible readback, independent of execution success and the Agent's goal. */
export interface ObservedEffect {
  schema: 'agent-mc-observed-effect/v1';
  skill: string;
  dimension: string;
  at: [number, number, number] | null;
  before: EffectSample;
  after: EffectSample;
  changed: { target: boolean | null; inventory: boolean | null; position: boolean | null; window: boolean | null };
  status: 'changed' | 'unchanged' | 'unknown';
  coverage: 'client-visible-only';
  goalVerified: false;
}
export interface EffectSample {
  at: string;
  target: { name: string; stateId: number } | null;
  inventory: Record<string, number> | null;
  position: [number, number, number] | null;
  /** null is a known closed window; undefined means unavailable. */
  window?: { id: number; type: string } | null;
}
