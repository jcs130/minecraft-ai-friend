import type { HarnessApi, IntentState } from './types.ts';

/** Structural subset of agent-mc-world `ToolDef` (assignable without importing that package). */
export interface HarnessToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  tags: readonly ('read' | 'write' | 'flow')[];
  bodyControl: 'independent';
  readOnlyCall?(args: Record<string, unknown>): boolean;
  handler(args: Record<string, unknown>, context?: unknown): Promise<{ text: string; data?: Record<string, unknown>; failed?: true }>;
}

const STATES: IntentState[] = ['queued', 'active', 'paused', 'done', 'cancelled', 'failed'];
const steps = { type: 'array', maxItems: 20, items: { type: 'object', required: ['tool', 'args'], additionalProperties: false,
  properties: { tool: { type: 'string', description: 'Body tool, e.g. mc_do' }, args: { type: 'object' }, note: { type: 'string' } } } };
const constraints = { type: 'object', properties: { steps, deadlineMs: { type: 'integer', minimum: 1000 },
  rules: { type: 'array', items: { type: 'string' }, maxItems: 10 } } };
const priority = { oneOf: [{ type: 'integer', minimum: 0, maximum: 100 }, { enum: ['low', 'normal', 'high', 'urgent'] }] };
const fail = (error: unknown) => ({ text: String((error as Error)?.message ?? error).slice(0, 300), failed: true as const });
const json = (value: unknown) => JSON.stringify(value);

/**
 * Host-facing tools (persona layer). They never move the body directly; intents are executed by the harness.
 * Text results are compact JSON so any host (DSH, Cortico, N.E.K.O, MCP) can parse them.
 */
export function createHarnessTools(api: HarnessApi): HarnessToolDef[] {
  return [
    {
      name: 'harness_submit_intent', tags: ['write'], bodyControl: 'independent', readOnlyCall: () => false,
      description: 'Ask the game body to pursue a goal. Returns an intentId at once; progress arrives as harness events. '
        + 'Free-text goals need explicit constraints.steps until a planner is configured (the intent pauses with a reason).',
      parameters: { type: 'object', required: ['goal'], additionalProperties: false,
        properties: { goal: { type: 'string', maxLength: 500 }, priority, constraints, hostRef: { type: 'string', maxLength: 200 } } },
      handler: async args => {
        try {
          const r = await api.submitIntent({ goal: String(args.goal ?? ''), priority: args.priority as never,
            constraints: args.constraints as never, hostRef: typeof args.hostRef === 'string' ? args.hostRef : undefined });
          return { text: json(r), data: r };
        } catch (error) { return fail(error); }
      },
    },
    {
      name: 'harness_get_summary', tags: ['read'], bodyControl: 'independent', readOnlyCall: () => true,
      description: 'Short game-state summary for the persona (active/queued intents, recent key events, relevant memory), '
        + 'bounded to max_tokens (default 300, max 800). Use topic to focus memory, e.g. a player name or "home".',
      parameters: { type: 'object', additionalProperties: false,
        properties: { topic: { type: 'string', maxLength: 100 }, max_tokens: { type: 'integer', minimum: 80, maximum: 800 } } },
      handler: async args => {
        try {
          const s = await api.getSummary({ topic: typeof args.topic === 'string' ? args.topic : undefined,
            maxTokens: typeof args.max_tokens === 'number' ? args.max_tokens : undefined });
          return { text: s.text, data: { tokens: s.tokens, budget: s.budget, truncated: s.truncated } };
        } catch (error) { return fail(error); }
      },
    },
    {
      name: 'harness_events', tags: ['read'], bodyControl: 'independent', readOnlyCall: () => true,
      description: 'Pull key events (death, task completed/failed, important interaction, new level, intent changes) after a cursor. '
        + 'Pass the returned latest as after next time. min_severity 3 = only interrupt-worthy events.',
      parameters: { type: 'object', additionalProperties: false, properties: { after: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 50 }, min_severity: { enum: [1, 2, 3] } } },
      handler: async args => {
        const r = api.pullEvents({ after: typeof args.after === 'number' ? args.after : 0, limit: typeof args.limit === 'number' ? args.limit : 20,
          minSeverity: [1, 2, 3].includes(args.min_severity as number) ? args.min_severity as 1 | 2 | 3 : 1 });
        return { text: json({ latest: r.latest, dropped: r.dropped, events: r.events.map(e => ({ seq: e.seq, at: e.at, kind: e.kind, severity: e.severity, text: e.text, intentId: e.intentId })) }),
          data: r as unknown as Record<string, unknown> };
      },
    },
    {
      name: 'harness_control', tags: ['write'], bodyControl: 'independent', readOnlyCall: args => args.action === 'list' || args.action === 'get',
      description: 'Manage intents: pause | resume | cancel | update (goal/priority/constraints) | get | list. '
        + 'pause/resume without intent_id pauses/resumes the whole harness executor.',
      parameters: { type: 'object', required: ['action'], additionalProperties: false, properties: {
        action: { enum: ['pause', 'resume', 'cancel', 'update', 'get', 'list'] }, intent_id: { type: 'string' },
        reason: { type: 'string', maxLength: 200 }, goal: { type: 'string', maxLength: 500 }, priority, constraints,
        states: { type: 'array', items: { enum: STATES } } } },
      handler: async args => {
        const id = typeof args.intent_id === 'string' ? args.intent_id : undefined;
        const reason = typeof args.reason === 'string' ? args.reason : undefined;
        try {
          switch (args.action) {
            case 'pause': return { text: json({ ok: true, intent: await api.pause(id, reason) }) };
            case 'resume': return { text: json({ ok: true, intent: await api.resume(id) }) };
            case 'cancel': if (!id) return fail('intent_id required'); return { text: json({ ok: true, intent: await api.cancel(id, reason) }) };
            case 'update': if (!id) return fail('intent_id required');
              return { text: json({ ok: true, intent: await api.updateIntent(id, { goal: args.goal as string | undefined,
                priority: args.priority as never, constraints: args.constraints as never }) }) };
            case 'get': if (!id) return fail('intent_id required'); return { text: json({ intent: api.getIntent(id) }) };
            case 'list': return { text: json({ intents: api.listIntents({ states: Array.isArray(args.states) ? args.states as IntentState[] : undefined, limit: 20 })
              .map(i => ({ id: i.id, goal: i.goal, state: i.state, priority: i.priority, reason: i.reason })) }) };
            default: return fail('unknown action');
          }
        } catch (error) { return fail(error); }
      },
    },
  ];
}
