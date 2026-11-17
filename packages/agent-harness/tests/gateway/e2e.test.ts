import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HarnessGatewayClient, startHarnessServer, type HarnessEvent } from '../../src/index.ts';
import { until } from '../helpers.ts';
import { TOKENS } from './setup.ts';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); });

describe('hosted runtime e2e (fake body, no network game server)', () => {
  it('third-party agent drives the body only through messages; harness owns the body exclusively', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'harness-e2e-')); cleanup.push(async () => rmSync(dir, { recursive: true, force: true }));
    await expect(startHarnessServer({ env: {} })).rejects.toThrow(/configPath or fakeBody/);
    const server = await startHarnessServer({ fakeBody: { completeAfterMs: 20, username: 'Komi' }, dataDir: dir, port: 0,
      env: { AGENT_HARNESS_GATEWAY_AGENTS: JSON.stringify({ agents: [{ id: 'neko', tokenEnv: 'NEKO_TOKEN' }] }), NEKO_TOKEN: TOKENS.neko } });
    cleanup.push(() => server.close());

    // Body surface: only harness tools remain visible; direct body calls are refused for anyone but the harness.
    expect(server.integration.exclusive).toBe(true);
    expect(server.client.tools().map(t => t.name).every(n => n.startsWith('harness_'))).toBe(true);
    await expect((server.client as any).call('mc_do', { steps: [{ skill: 'x' }] })).rejects.toThrow(/reserved for the body owner/);

    const agent = new HarnessGatewayClient({ url: server.gateway.url, token: TOKENS.neko, clientName: 'e2e-agent' });
    cleanup.push(() => agent.close());
    const welcome = await agent.connect();
    expect(welcome).toMatchObject({ agent: 'neko', server: { execute: true, exclusiveBody: true } });
    const events: HarnessEvent[] = [];
    await agent.subscribe(e => events.push(e), { minSeverity: 2 });

    const { intentId } = await agent.submitIntent({ goal: '做钓竿然后钓鱼', priority: 'high', constraints: { steps: [
      { tool: 'mc_do', args: { steps: [{ skill: 'craft_rod' }] } }, { tool: 'mc_do', args: { steps: [{ skill: 'fish' }] } }] } });
    await until(() => events.some(e => e.intentId === intentId && (e.data as any)?.state === 'done'), 5000);
    expect(server.fake!.calls.filter(c => c.tool === 'mc_do').map(c => (c.args.steps as any)[0].skill)).toEqual(['craft_rod', 'fish']);
    expect(events.filter(e => e.kind === 'task_completed')).toHaveLength(2);

    // Free-text goal → needs host → agent supplies steps → resumes → done.
    const free = await agent.submitIntent({ goal: '去村庄看看' });
    await until(() => events.some(e => e.intentId === free.intentId && (e.data as any)?.needsHost));
    await agent.updateIntent(free.intentId, { constraints: { steps: [{ tool: 'mc_do', args: { steps: [{ skill: 'goto_village' }] } }] } });
    await agent.resume(free.intentId);
    await until(() => events.some(e => e.intentId === free.intentId && (e.data as any)?.state === 'done'), 5000);

    // Body events flow to the agent and into memory.
    await server.fake!.push({ type: 'minecraft.chat', text: '[MC 私聊] Steve: Komi 我喜欢红石', meta: { uname: 'Steve' } });
    await until(() => events.some(e => e.kind === 'interaction'));
    await server.integration.harness.idle();
    const summary = await agent.getSummary({ topic: 'Steve', maxTokens: 200 });
    expect(summary.text).toContain('Steve LIKES 红石');
    expect(summary.tokens).toBeLessThanOrEqual(200);
  }, 60_000); // first import of the agent-mc-world sources through vite is slow
});
