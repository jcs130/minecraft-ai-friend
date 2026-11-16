import type { BodyOutcome, BodyPort } from '../src/index.ts';

export const tick = () => new Promise(r => setTimeout(r, 0));
export async function until(cond: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error('timeout waiting for condition'); await new Promise(r => setTimeout(r, 5)); }
}

/** Fake body: mc_do is accepted asynchronously (like agent-mc-world tasks) and completes when `finish` is called. */
export function fakeBody(options: { fail?: string; sync?: boolean } = {}) {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  let n = 0;
  const body: BodyPort = {
    async call(tool, args): Promise<BodyOutcome> {
      calls.push({ tool, args });
      if (tool === 'mc_stop') return { text: 'stopped' };
      if (options.fail && tool === options.fail) return { text: 'cannot do that', failed: true };
      if (options.sync) return { text: `${tool} ok`, execution: { kind: 'task', id: `t${++n}`, phase: 'completed', terminal: true } };
      return { text: `${tool} accepted`, execution: { kind: 'task', id: `t${++n}`, phase: 'accepted', terminal: false } };
    },
  };
  return { body, calls, lastTask: () => `t${n}` };
}
export const terminal = (id: string, phase = 'completed') => ({ type: 'minecraft.task', ts: new Date().toISOString(), text: `task ${phase}`,
  execution: { kind: 'task', id, phase, terminal: true } });
export const doStep = (skill: string) => ({ tool: 'mc_do', args: { steps: [{ skill }] } });
