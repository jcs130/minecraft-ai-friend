import { afterEach, describe, expect, it } from 'vitest';
import { guardBody, NumenBodyAdapter, McbotNumenPort } from '../../src/index.ts';
import { m, post, rig, TOKENS } from '../gateway/setup.ts';
import { fakeMcbotServer } from './drivers.ts';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); });

describe('gateway over the unified body', () => {
  it('welcome/get_body expose capabilities; steps the body cannot do are refused up front', async () => {
    const r = await rig(); cleanup.push(r.close);
    const server = fakeMcbotServer();
    const body = guardBody(new NumenBodyAdapter({ port: new McbotNumenPort({ connection: server.conn, name: 'Asuna', serverId: 'qd', timeoutMs: 1000 }), pollMs: 0, resultPollMs: 0 }));
    await body.spawn(); cleanup.push(() => body.destroy());
    r.harness.attachBody(body);

    const hello = await post(r.gateway.url, m('hello', { token: TOKENS.neko }));
    expect(hello.body.payload.body).toMatchObject({ kind: 'numen', transport: 'mcbot', lifecycle: 'ready' });
    expect(hello.body.payload.body.verbs).toContain('move');

    const info = await post(r.gateway.url, m('get_body', { include: ['capabilities', 'health', 'snapshot'] }), TOKENS.neko);
    expect(info.status).toBe(200);
    const b = info.body.payload.body;
    expect(b.capabilities.actions.move.native).toBe('move_to');
    expect(b.health.safety.halted).toBe(false);
    expect(b.snapshot).toMatchObject({ position: { x: 5, y: 70, z: -2 }, health: 20 });
    expect(b.identity.scope).toBeUndefined(); // scope/owner only for admins

    const bad = await post(r.gateway.url, m('submit_intent', { goal: 'sit', constraints: { steps: [{ tool: 'body:sit', args: {} }] } }), TOKENS.neko);
    expect(bad.body.payload.code).toBe('bad_request');
    expect(bad.body.payload.message).toMatch(/does not support "sit"/);
    const legacy = await post(r.gateway.url, m('submit_intent', { goal: 'x', constraints: { steps: [{ tool: 'mc_do', args: {} }] } }), TOKENS.neko);
    expect(legacy.body.payload.message).toMatch(/Mineflayer/);
    const ok = await post(r.gateway.url, m('submit_intent', { goal: 'walk', constraints: { steps: [{ tool: 'body:move', args: { x: 1, y: 70, z: 1 } }] } }), TOKENS.neko);
    expect(ok.body.type).toBe('result');
  });
});
