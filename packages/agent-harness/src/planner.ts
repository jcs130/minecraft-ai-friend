import type { BodyStep, Intent } from './types.ts';
import type { BodyCapabilities } from './body/types.ts';
import { BODY_STEP, stepSupport } from './body/harness-port.ts';

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

export interface PlanContext {
  summary: () => Promise<string>;
  /** Capabilities of the bound body (unified BodyAdapter); null when unknown. Planners must not emit unsupported steps. */
  capabilities?: () => BodyCapabilities | null;
}
export type PlanResult = { steps: BodyStep[] } | { needsHost: string };

/** Turns an intent into body steps. Phase 1 ships only explicit-steps planning; an LLM planner plugs in here later. */
export interface Planner { plan(intent: Intent, context: PlanContext): Promise<PlanResult> }

/** Legacy agent-mc-world body tools (Mineflayer body only). */
export const LEGACY_BODY_TOOLS = /^(mc|mymc)_(do|goal|stop|queue|observe|check|bag|map|scout|visual|window|escape)$/;
/** Allowed step tools: unified `body:<verb>` / `body:native:<name>` steps plus the legacy agent-mc-world tools. */
export const BODY_TOOL_ALLOWLIST = { test: (tool: string) => BODY_STEP.test(tool) || LEGACY_BODY_TOOLS.test(tool) } as const;

/**
 * Uses host-provided `constraints.steps`. A free-text goal without steps is returned to the host (`needsHost`), never
 * guessed. Only allow-listed body tools are accepted, so an intent cannot reach host-only/admin tools.
 */
export class ExplicitStepsPlanner implements Planner {
  constructor(private readonly allow: { test(tool: string): boolean } = BODY_TOOL_ALLOWLIST) {}
  async plan(intent: Intent, context?: PlanContext): Promise<PlanResult> {
    const steps = intent.constraints.steps;
    if (!Array.isArray(steps) || steps.length === 0)
      return { needsHost: 'No planner for a free-text goal yet: update_intent with constraints.steps (e.g. mc_do skill steps).' };
    if (steps.length > 20) return { needsHost: 'Too many steps (max 20).' };
    for (const s of steps) {
      if (!s || typeof s.tool !== 'string' || !this.allow.test(s.tool) || typeof s.args !== 'object' || s.args === null || Array.isArray(s.args))
        return { needsHost: `Step tool not allowed or malformed: ${String(s?.tool)}` };
      // Graceful degradation: a step the bound body cannot do goes back to the host instead of failing on the body.
      const unsupported = stepSupport(s.tool, context?.capabilities?.() ?? null);
      if (unsupported) return { needsHost: `Step not supported by this body: ${unsupported}` };
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
