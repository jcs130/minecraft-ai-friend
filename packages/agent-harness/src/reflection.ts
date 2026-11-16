import type { HarnessEvent, Intent } from './types.ts';

/**
 * Phase 3 extension points (interfaces only in Phase 1).
 * - `Reflector` turns an ended intent or a failure into lessons (normally an LLM worker).
 * - `HostMemoryWriter` lets the host persona store the lesson in *its own* memory (N.E.K.O / Cortico / DSH),
 *   separate from the harness game memory.
 */
export interface ReflectionTrigger {
  kind: 'intent_ended' | 'death' | 'task_failed';
  intent: Intent | null;
  events: HarnessEvent[];
}
export interface ReflectionNote {
  summary: string;
  /** Facts to write into game memory, e.g. "Player:Steve LIKES Topic:红石". Phase 3. */
  facts?: Array<{ subject: string; relation: string; object?: string; value?: string | number | boolean; negate?: boolean }>;
  importance?: number;
}
export interface Reflector { reflect(trigger: ReflectionTrigger, signal: AbortSignal): Promise<ReflectionNote | null> }
export interface HostMemoryWriter { write(note: ReflectionNote, trigger: ReflectionTrigger): Promise<void> }

/** Default: no reflection (no model calls). */
export const NO_REFLECTION: Reflector = { reflect: async () => null };
