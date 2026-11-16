/**
 * Harness Runtime public contract (Phase 1).
 *
 * Layering:  Host (persona: N.E.K.O / Cortico / DSH)  →  HarnessApi  →  Body (agent-mc-world tools/events)
 * The host decides *what* to do (intents) and reads bounded summaries/key events. It never needs the full game state.
 */

export const HARNESS_PROTOCOL = 'agent-mc-harness/v1' as const;

export type IntentState = 'queued' | 'active' | 'paused' | 'done' | 'cancelled' | 'failed';
export const TERMINAL_STATES: readonly IntentState[] = ['done', 'cancelled', 'failed'];

/** 0..100. Named levels map to 20/50/75/95. `urgent` (≥90) may preempt the active intent. */
export type PriorityInput = number | 'low' | 'normal' | 'high' | 'urgent';

/** One explicit body action, executed through the body's `mc_do`-style tool. */
export interface BodyStep { tool: string; args: Record<string, unknown>; note?: string }

export interface IntentConstraints {
  /** Explicit body steps chosen by the host. Without them a free-text goal needs a Planner. */
  steps?: BodyStep[];
  /** Give up after this long (ms, wall clock). */
  deadlineMs?: number;
  /** Free-form host constraints, passed to the planner verbatim (e.g. "stay near home", "no PvP"). */
  rules?: string[];
  [key: string]: unknown;
}

export interface IntentInput {
  goal: string;
  priority?: PriorityInput;
  constraints?: IntentConstraints;
  /** Opaque host reference (conversation id, request id ...). */
  hostRef?: string;
}

export interface Intent {
  id: string;
  goal: string;
  priority: number;
  constraints: IntentConstraints;
  hostRef: string | null;
  state: IntentState;
  /** Why it is paused/failed, or the latest progress note. */
  reason: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  /** Plan produced for this intent and how far execution got. */
  plan: BodyStep[] | null;
  stepIndex: number;
  attempts: number;
  result: string | null;
}

export interface IntentPatch { goal?: string; priority?: PriorityInput; constraints?: IntentConstraints }

export type HarnessEventKind =
  | 'death' | 'task_completed' | 'task_failed' | 'interaction' | 'skill' | 'player_presence'
  | 'intent_state' | 'reflection';

/** Key event pushed to the host. Text is short and human-readable; `data` is structured. */
export interface HarnessEvent {
  seq: number;
  at: string;
  kind: HarnessEventKind;
  /** 1 = info, 2 = notable, 3 = important (interrupt-worthy for a host). */
  severity: 1 | 2 | 3;
  text: string;
  intentId?: string;
  data?: Record<string, unknown>;
}

export interface SummaryOptions { topic?: string; maxTokens?: number }
export interface Summary { text: string; tokens: number; budget: number; truncated: boolean; generatedAt: string }

export type ControlAction = 'pause' | 'resume' | 'cancel' | 'update';

/** Everything a host may call. Intentionally small. */
export interface HarnessApi {
  submitIntent(input: IntentInput): Promise<{ intentId: string; state: IntentState }>;
  getSummary(options?: SummaryOptions): Promise<Summary>;
  /** Push: returns an unsubscribe function. Callbacks never block the harness. */
  subscribe(listener: (event: HarnessEvent) => void, filter?: { minSeverity?: 1 | 2 | 3 }): () => void;
  /** Pull: events with seq > after (bounded ring buffer). */
  pullEvents(options?: { after?: number; limit?: number; minSeverity?: 1 | 2 | 3 }): { events: HarnessEvent[]; latest: number; dropped: boolean };
  /** Without an id pauses/resumes the whole harness executor. */
  pause(intentId?: string, reason?: string): Promise<Intent | null>;
  resume(intentId?: string): Promise<Intent | null>;
  updateIntent(intentId: string, patch: IntentPatch): Promise<Intent>;
  cancel(intentId: string, reason?: string): Promise<Intent>;
  getIntent(intentId: string): Intent | null;
  listIntents(options?: { states?: IntentState[]; limit?: number }): Intent[];
}
