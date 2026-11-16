import type { BodyStep, Intent } from './types.ts';

/** Minimal body surface the harness needs. agent-mc-world `MinecraftAgentClient.call` satisfies it via `clientBodyPort`. */
export interface BodyOutcome {
  text: string;
  failed?: boolean;
  /** agent-mc-world ExecutionReceipt: a non-terminal receipt means the work continues and ends with a later event. */
  execution?: { kind: string; id: string; phase: string; terminal: boolean };
}
export interface BodyPort {
  call(tool: string, args: Record<string, unknown>, signal: AbortSignal): Promise<BodyOutcome>;
}

/** Adapter for agent-mc-world MinecraftAgentClient (structural, no import). */
export type BodyClientLike = { call(name: string, args: Record<string, unknown>, options?: { signal?: AbortSignal; bodyKey?: object }): Promise<BodyOutcome> };
/** `bodyKey` is the capability for agent-mc-world `bodyGate` (exclusive body control). */
export function clientBodyPort(client: BodyClientLike, bodyKey?: object): BodyPort {
  return { call: (tool, args, signal) => client.call(tool, args, bodyKey ? { signal, bodyKey } : { signal }) };
}

export interface PlanContext { summary: () => Promise<string> }
export type PlanResult = { steps: BodyStep[] } | { needsHost: string };

/** Turns an intent into body steps. Phase 1 ships only explicit-steps planning; an LLM planner plugs in here later. */
export interface Planner { plan(intent: Intent, context: PlanContext): Promise<PlanResult> }

export const BODY_TOOL_ALLOWLIST = /^(mc|mymc)_(do|goal|stop|queue|observe|check|bag|map|scout|visual|window|escape)$/;

/**
 * Uses host-provided `constraints.steps`. A free-text goal without steps is returned to the host (`needsHost`), never
 * guessed. Only allow-listed body tools are accepted, so an intent cannot reach host-only/admin tools.
 */
export class ExplicitStepsPlanner implements Planner {
  constructor(private readonly allow: RegExp = BODY_TOOL_ALLOWLIST) {}
  async plan(intent: Intent): Promise<PlanResult> {
    const steps = intent.constraints.steps;
    if (!Array.isArray(steps) || steps.length === 0)
      return { needsHost: 'No planner for a free-text goal yet: update_intent with constraints.steps (e.g. mc_do skill steps).' };
    if (steps.length > 20) return { needsHost: 'Too many steps (max 20).' };
    for (const s of steps) {
      if (!s || typeof s.tool !== 'string' || !this.allow.test(s.tool) || typeof s.args !== 'object' || s.args === null || Array.isArray(s.args))
        return { needsHost: `Step tool not allowed or malformed: ${String(s?.tool)}` };
    }
    return { steps: steps.map(s => ({ tool: s.tool, args: structuredClone(s.args), ...(s.note ? { note: s.note } : {}) })) };
  }
}

/** Try planners in order; first one that yields steps wins. */
export class ChainPlanner implements Planner {
  constructor(private readonly planners: Planner[]) {}
  async plan(intent: Intent, context: PlanContext): Promise<PlanResult> {
    let last: PlanResult = { needsHost: 'no planner' };
    for (const p of this.planners) { last = await p.plan(intent, context); if ('steps' in last) return last; }
    return last;
  }
}
