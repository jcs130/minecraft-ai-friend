import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger } from '../../agent-mc-world/src/client/index.ts';
import type { ToolDef, WorldHost } from '../../agent-mc-world/src/client/contracts.ts';
import { harnessConfigFromEnv, withAgentHarness } from '../src/index.ts';
import { until } from './helpers.ts';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'harness-int-')); dirs.push(d); return d; };

/** Fake body world exposing mc_do (async task receipts) and mc_stop, like agent-mc-world. */
function fakeWorld() {
  let host!: WorldHost; let n = 0; const calls: string[] = [];
  const tool = (name: string, handler: ToolDef['handler']): ToolDef => ({ name, description: name, parameters: { type: 'object' }, tags: ['act'], handler });
  const world = {
    id: 'minecraft', envPromptVars: () => ({}), start: async (h: WorldHost) => { host = h; }, stop: async () => {},
    requestFacts: () => ({ text: '', snapshotTypes: [], world: { schema: 'agent-mc-world-identity/v1' as const, key: 'minecraft:overworld', uuid: null,
      instanceId: null, dimensionType: 'minecraft:overworld', source: 'vanilla-login' as const, revision: 1, observedAt: null },
      experience: { scope: { realm: 'test-realm', account: 'offline:Komi', agent: 'komi' }, observation: null } }),
    tools: () => [
      tool('mc_do', async args => { calls.push(`mc_do:${JSON.stringify(args)}`); return { text: 'accepted',
        execution: { kind: 'task' as const, id: `task-${++n}`, phase: 'accepted' as const, terminal: false, goalCompleted: false as const } }; }),
      tool('mc_stop', async () => { calls.push('mc_stop'); return { text: 'stopped' }; }),
    ],
  };
  return { world, calls, host: () => host, last: () => `task-${n}` };
}
const clientOptions = (dataDir: string) => ({ dataDir, log: nullLogger(), cfg: { ...structuredClone(MINECRAFT_CLIENT_DEFAULTS), host: 'offline.invalid', username: 'Komi' } });

describe('withAgentHarness', () => {
  it('is off by default: same options object, no files, no tools', () => {
    expect(harnessConfigFromEnv({})).toMatchObject({ enabled: false, execute: false, exposeMemoryTools: false, memory: { enabled: true, backend: 'local' } });
    const options = clientOptions(tmp());
    const r = withAgentHarness(options, harnessConfigFromEnv({}));
    expect(r.options).toBe(options);
    expect(r.integration).toBeNull();
  });

  it('end-to-end through MinecraftAgentClient: host tools → intent → body → task receipt → memory + summary', async () => {
    const dataDir = tmp(); const f = fakeWorld();
    const { options, integration } = withAgentHarness(clientOptions(dataDir),
      harnessConfigFromEnv({ AGENT_HARNESS_ENABLED: '1', AGENT_HARNESS_EXECUTE: '1' }));
    const client = new MinecraftAgentClient(options, f.world);
    integration!.attachClient(client);
    await client.connect();
    expect(client.tools().map(t => t.name)).toEqual(['mc_do', 'mc_stop', 'mc_practice', 'harness_submit_intent', 'harness_get_summary', 'harness_events', 'harness_control']);

    // Body events go through the real host.pushEvent → eventObservers path.
    await f.host().pushEvent({ type: 'minecraft.chat', source: 'minecraft', ts: new Date().toISOString(), text: '[MC 私聊] Steve: 我喜欢钓鱼', meta: { uname: 'Steve' } });

    const submitted = JSON.parse((await client.call('harness_submit_intent', { goal: '去钓鱼', constraints: { steps: [{ tool: 'mc_do', args: { steps: [{ skill: 'fish' }] } }] } })).text);
    await until(() => f.calls.length === 1);
    await f.host().pushEvent({ type: 'minecraft.task', source: 'minecraft', ts: new Date().toISOString(), text: '钓鱼完成',
      execution: { kind: 'task', id: f.last(), phase: 'completed', terminal: true, goalCompleted: false } });
    await until(() => integration!.harness.getIntent(submitted.intentId)!.state === 'done');

    const events = JSON.parse((await client.call('harness_events', { after: 0 })).text);
    expect(events.events.map((e: { kind: string }) => e.kind)).toEqual(['interaction', 'intent_state', 'intent_state', 'task_completed', 'intent_state']);
    await integration!.harness.idle();
    const summary = await client.call('harness_get_summary', { topic: 'Steve', max_tokens: 200 });
    expect(summary.text).toContain('Steve LIKES 钓鱼');
    expect((summary.data as { tokens: number }).tokens).toBeLessThanOrEqual(200);
    const list = JSON.parse((await client.call('harness_control', { action: 'list' })).text);
    expect(list.intents[0]).toMatchObject({ goal: '去钓鱼', state: 'done' });
    await client.disconnect();
    await integration!.close();
  });

  it('enabled without execute tracks intents but never drives the body', async () => {
    const f = fakeWorld();
    const { options, integration } = withAgentHarness(clientOptions(tmp()), harnessConfigFromEnv({ AGENT_HARNESS_ENABLED: '1' }));
    const client = new MinecraftAgentClient(options, f.world);
    integration!.attachClient(client);
    await client.connect();
    const r = JSON.parse((await client.call('harness_submit_intent', { goal: '砍树', constraints: { steps: [{ tool: 'mc_do', args: {} }] } })).text);
    await new Promise(res => setTimeout(res, 20));
    expect(integration!.harness.getIntent(r.intentId)!.state).toBe('queued');
    expect(f.calls).toEqual([]);
    expect((await client.call('harness_control', { action: 'cancel', intent_id: r.intentId })).text).toContain('"cancelled"');
    await client.disconnect();
    await integration!.close();
  });
});
