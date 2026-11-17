/**
 * Offline fake Minecraft body for tests and local demos (`serve --fake-body`). It never opens a network connection.
 * `mc_do` is accepted asynchronously like agent-mc-world tasks and completes (terminal task event) after `completeAfterMs`.
 */
export interface FakeWorldOptions { username?: string; completeAfterMs?: number; failSkills?: readonly string[] }

interface HostLike { pushEvent(event: Record<string, unknown>): Promise<unknown> }
type Handler = (args: Record<string, unknown>) => Promise<{ text: string; failed?: true; execution?: Record<string, unknown> }>;

export function createFakeWorld(options: FakeWorldOptions = {}) {
  let host: HostLike | null = null;
  let n = 0;
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const running = new Map<string, ReturnType<typeof setTimeout>>();
  const now = () => new Date().toISOString();
  const finish = (id: string, phase: 'completed' | 'blocked' | 'cancelled', text: string) => {
    running.delete(id);
    void host?.pushEvent({ type: 'minecraft.task', source: 'minecraft', ts: now(), text,
      execution: { kind: 'task', id, phase, terminal: true, goalCompleted: false } });
  };
  const tool = (name: string, tags: string[], handler: Handler) => ({ name, description: `fake ${name}`, parameters: { type: 'object' }, tags,
    handler: async (args: Record<string, unknown>) => { calls.push({ tool: name, args }); return handler(args); } });
  const tools = [
    tool('mc_do', ['act'], async args => {
      const steps = Array.isArray(args.steps) ? args.steps as Array<{ skill?: string }> : [];
      const skill = steps.map(s => s.skill ?? '?').join('+') || 'noop';
      const id = `fake-task-${++n}`;
      const fail = options.failSkills?.some(f => skill.includes(f));
      running.set(id, setTimeout(() => finish(id, fail ? 'blocked' : 'completed', `fake: ${skill} ${fail ? 'blocked' : 'done'}`), options.completeAfterMs ?? 50));
      return { text: `accepted ${skill}`, execution: { kind: 'task', id, phase: 'accepted', terminal: false, goalCompleted: false } };
    }),
    tool('mc_stop', ['act'], async () => {
      for (const [id, timer] of running) { clearTimeout(timer); finish(id, 'cancelled', 'fake: stopped'); }
      return { text: 'stopped' };
    }),
    tool('mc_observe', ['read'], async () => ({ text: 'fake: grass, a tree, nobody around' })),
  ];
  const world = {
    id: 'minecraft',
    envPromptVars: () => ({}),
    start: async (h: HostLike) => { host = h; },
    stop: async () => { for (const t of running.values()) clearTimeout(t); running.clear(); host = null; },
    requestFacts: () => ({ text: '', snapshotTypes: [], world: { schema: 'agent-mc-world-identity/v1' as const, key: 'fake:overworld', uuid: null,
      instanceId: null, dimensionType: 'minecraft:overworld', source: 'vanilla-login' as const, revision: 1, observedAt: null },
      experience: { scope: { realm: 'fake-realm', account: `offline:${options.username ?? 'HarnessBot'}`, agent: (options.username ?? 'HarnessBot').toLowerCase() }, observation: null } }),
    tools: () => tools,
  };
  return {
    world, calls,
    /** Simulate a body event (chat, death …). */
    push: (event: Record<string, unknown>) => host ? host.pushEvent({ source: 'minecraft', ts: now(), ...event }) : Promise.reject(new Error('fake world not started')),
    started: () => host !== null,
  };
}
