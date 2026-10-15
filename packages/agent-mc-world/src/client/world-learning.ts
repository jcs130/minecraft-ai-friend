import { createHash, randomUUID } from 'node:crypto';
import { ClientOperationLearning } from './operation-learning.ts';
import type { ToolDef, WorldHost, WorldRequestFacts } from './contracts.ts';
import type { OperationAttribution } from '../../core/operation-experience.ts';

/** Evidence port for direct World hosts which do not call MinecraftAgentClient.
 * This is an observer, not a dispatcher, planner or personal-memory writer.
 * Do not install it around an SDK host that already collects these operations.
 */
export class WorldOperationLearning {
  private current: { run: string; collector: ClientOperationLearning } | null = null;

  constructor(private readonly dataDir: string | undefined,
    private readonly facts: () => WorldRequestFacts | null) {}

  start(host: WorldHost): WorldHost {
    if (!this.dataDir) return host;
    if (this.current) throw new Error('World operation learning is already attached');
    // A direct host need not expose its run ID. Keep a distinct capture run and
    // correlate via original tool call IDs and execution IDs, never invent a host run.
    const run = `world-${randomUUID()}`;
    const collector: ClientOperationLearning = new ClientOperationLearning(this.dataDir, run,
      (): WorldRequestFacts | null => this.current?.collector === collector ? this.facts() : null, () => {
      throw new Error('No confirmed game identity available for operation evidence');
    });
    this.current = { run, collector };
    return { ...host,
      pushEvent: async (event, options) => {
        if (this.current?.collector === collector && event.execution) collector.execution(event.execution);
        return host.pushEvent(event, options);
      },
      recallGameLessons: query => collector.recall(query),
    };
  }

  stop(): void { this.current = null; }
  status() { return this.current ? { run: this.current.run, ...this.current.collector.status() }
    : { run: null, protocol: 'agent-mc-experience/v1', attached: false }; }

  tools(tools: ToolDef[], controller?: OperationAttribution['controller']): ToolDef[] {
    return tools.map(tool => ({ ...tool, handler: async (args, ctx) => {
      const active = this.current;
      if (!active) return tool.handler(args, ctx);
      const { collector } = active;
      const callId = ctx.callId ?? randomUUID();
      const attribution: OperationAttribution = {
        controller: controller ?? (ctx.role === 'main' ? 'system2' : ctx.role === 'host-decision' ? 'system1' : 'unknown'),
        ...(typeof args.code === 'string' && tool.name.endsWith('_script') ? {
          method: { id: typeof args.name === 'string' ? args.name : 'inline-script',
            revision: createHash('sha256').update(args.code).digest('hex') },
        } : {}),
      };
      const pending = collector.begin(tool, args, callId, attribution);
      let result;
      try { result = await tool.handler(args, ctx); }
      catch (error) { collector.finish(pending, null); throw error; }
      const outcome = typeof result === 'string' ? { text: result } : result;
      const experience = collector.finish(pending, outcome);
      for (const event of outcome.events ?? []) if (event.execution) collector.execution(event.execution);
      let decision: { id: string; protocol: string } | null = null;
      if (tool.name.endsWith('_choose')) {
        try {
          const chosen = JSON.parse(outcome.text);
          const row = collector.recordDecision({ id: chosen.decisionId ?? callId,
            category: String(args.category), selected: chosen.choice ?? null, status: chosen.status ?? 'unknown',
            candidates: Array.isArray(args.candidates) ? args.candidates.map(c => ({ id: c.id, ready: c.ready,
              probability: c.id === chosen.choice ? chosen.probability : null })) : [],
            model: chosen.model ?? null, elapsedMs: chosen.elapsedMs ?? null, inputTokens: chosen.inputTokens ?? null,
            recalledMemoryRefs: chosen.recalledMemoryRefs ?? [],
          });
          if (row) decision = { id: row.id, protocol: row.schema };
        } catch { /* Unrecognized results stay unverified; do not alter the real tool result. */ }
      }
      const memoryStatus = tool.name.endsWith('_memory') && ['help', 'experience'].includes(String(args.action));
      if (outcome.execution?.kind === 'observation' || (!experience && !decision && !memoryStatus)) return result;
      return { ...outcome, meta: { ...outcome.meta,
        ...(experience || decision ? { experience: experience ?? decision } : {}),
        ...(memoryStatus ? { operationLearning: { run: active.run, ...collector.status() } } : {}),
      } };
    } }));
  }
}
