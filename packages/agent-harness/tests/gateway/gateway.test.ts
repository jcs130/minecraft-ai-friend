import { afterEach, describe, expect, it } from 'vitest';
import { HarnessGatewayClient, GatewayRequestError, startGateway, HarnessRuntime, type HarnessEvent } from '../../src/index.ts';
import { until } from '../helpers.ts';
import { death, m, post, rawWs, rig, TOKENS } from './setup.ts';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); });
async function setup(extra: Parameters<typeof rig>[0] = {}) { const r = await rig(extra); cleanup.push(r.close); return r; }
function sdk(url: string, token: string | undefined, extra: Partial<ConstructorParameters<typeof HarnessGatewayClient>[0]> = {}) {
  const c = new HarnessGatewayClient({ url, token, requestTimeoutMs: 3000, ...extra }); cleanup.push(() => c.close()); return c;
}
const steps = [{ tool: 'mc_do', args: { steps: [{ skill: 'fish' }] } }];

describe('gateway auth', () => {
  it('rejects missing/invalid tokens over HTTP and WS, never logs token values, throttles failures', async () => {
    const r = await setup({ limits: { authFailuresPerMinute: 4 } });
    expect((await post(r.gateway.url, m('ping'))).status).toBe(401);
    const bad = await post(r.gateway.url, m('ping', {}, 'p1'), 'wrong-token-0123456789');
    expect(bad).toMatchObject({ status: 401, body: { type: 'error', re: 'p1', payload: { code: 'unauthorized' } } });

    const ws = await rawWs(r.gateway.wsUrl);
    ws.send(m('ping', {}, 'w0'));
    expect((await ws.reply('w0')).payload.code).toBe('unauthorized');
    await until(() => ws.closed() !== null);
    expect(ws.closed()!.code).toBe(1008);

    const ws2 = await rawWs(r.gateway.wsUrl);
    ws2.send(m('hello', { token: 'also-wrong-token-0123456789' }, 'w1'));
    expect((await ws2.reply('w1')).payload.code).toBe('unauthorized');
    // 4 failures (2 missing, 2 invalid) from this address → further attempts are throttled even with a valid token.
    const limited = await post(r.gateway.url, m('hello', { token: TOKENS.neko }));
    expect(limited.status).toBe(429);
    expect(limited.body.payload.code).toBe('rate_limited');

    const joined = r.logs.join('\n');
    for (const t of [...Object.values(TOKENS), 'wrong-token-0123456789', 'also-wrong-token-0123456789']) expect(joined).not.toContain(t);
    expect(joined).toContain('gateway auth rejected');
  });

  it('accepts Bearer header or hello; refuses foreign origins and non-loopback binds without tokens', async () => {
    const r = await setup();
    const ok = await post(r.gateway.url, m('ping', { nonce: 'n1' }), TOKENS.neko);
    expect(ok).toMatchObject({ status: 200, body: { type: 'pong', payload: { nonce: 'n1' } } });
    const hello = await post(r.gateway.url, m('hello', { token: TOKENS.cortico }));
    expect(hello.body).toMatchObject({ type: 'welcome', payload: { agent: 'cortico', admin: false, v: 1 } });
    expect((await post(r.gateway.url, m('ping'), TOKENS.neko, { origin: 'https://evil.example' })).status).toBe(403);
    await expect(rawWs(r.gateway.wsUrl, { origin: 'https://evil.example' })).rejects.toThrow(/403/);
    const h = new HarnessRuntime({ self: 'x' });
    await expect(startGateway({ harness: h, host: '0.0.0.0', port: 0 })).rejects.toThrow(/without agent tokens/);
    // Anonymous loopback mode when no agents are configured.
    const anon = await startGateway({ harness: h, port: 0, heartbeatMs: 0 }); cleanup.push(() => anon.close());
    expect((await post(anon.url, m('hello'))).body.payload).toMatchObject({ agent: 'anonymous', anonymous: true });
  });
});

describe('gateway multi-tenancy', () => {
  it('isolates intents per agent; admin can see and control everything', async () => {
    const r = await setup();
    const neko = sdk(r.gateway.url, TOKENS.neko, { transport: 'http' }), cortico = sdk(r.gateway.url, TOKENS.cortico, { transport: 'http' });
    const admin = sdk(r.gateway.url, TOKENS.admin, { transport: 'http' });
    await Promise.all([neko.connect(), cortico.connect(), admin.connect()]);
    const { intentId } = await neko.submitIntent({ goal: '秘密基地挖矿', constraints: { steps } });
    const forbidden = async (p: Promise<unknown>) => { await expect(p).rejects.toMatchObject({ code: 'forbidden' }); };
    await forbidden(cortico.getIntent(intentId));
    await forbidden(cortico.cancel(intentId));
    await forbidden(cortico.updateIntent(intentId, { priority: 10 }));
    await forbidden(cortico.pause(intentId));
    await forbidden(cortico.pause());                                   // whole-harness pause is admin-only
    await forbidden(neko.submitIntent({ goal: 'x', priority: 'urgent' })); // above neko's max priority
    await expect(cortico.getIntent('int_nope')).rejects.toMatchObject({ code: 'not_found' });
    expect(await cortico.listIntents()).toEqual([]);
    expect((await neko.listIntents()).map(i => i.owner)).toEqual(['neko']);
    expect((await admin.listIntents()).map(i => i.id)).toContain(intentId);

    const summary = await cortico.getSummary();
    expect(summary.text).not.toContain('秘密基地');
    const pulled = await cortico.pullEvents({ after: 0 });
    expect(pulled.events.filter(e => e.intentId === intentId)).toEqual([]);
    death(r.harness);
    expect((await cortico.pullEvents({ after: 0 })).events.map(e => e.kind)).toContain('death');   // shared body events are visible

    // Envelope agent must match the credential.
    expect((await post(r.gateway.url, { ...m('ping'), agent: 'neko' }, TOKENS.cortico)).body.payload.code).toBe('forbidden');
    // Quota: neko may hold at most 3 open intents.
    await neko.submitIntent({ goal: 'b' }); await neko.submitIntent({ goal: 'c' });
    await expect(neko.submitIntent({ goal: 'd' })).rejects.toMatchObject({ code: 'quota_exceeded' });
    // Steps may only use allow-listed body tools.
    await expect(cortico.submitIntent({ goal: 'op me', constraints: { steps: [{ tool: 'mc_admin', args: {} }] } })).rejects.toMatchObject({ code: 'bad_request' });

    expect((await admin.cancel(intentId, 'ops override')).state).toBe('cancelled');
    await expect(neko.cancel(intentId)).rejects.toMatchObject({ code: 'conflict' });
    await admin.pause();
    expect((await admin.getSummary()).text).toContain('已暂停');
  });

  it('rate limits per agent (HTTP 429 + Retry-After)', async () => {
    const r = await setup({ agents: [{ id: 'neko', tokenEnv: 'NEKO_TOKEN', ratePerMinute: 60, burst: 3 }] });
    for (let i = 0; i < 3; i++) expect((await post(r.gateway.url, m('ping'), TOKENS.neko)).status).toBe(200);
    const limited = await post(r.gateway.url, m('ping', {}, 'rl'), TOKENS.neko);
    expect(limited).toMatchObject({ status: 429, body: { re: 'rl', payload: { code: 'rate_limited' } } });
    expect(limited.body.payload.retryAfterMs).toBeGreaterThan(0);
    expect(limited.headers.get('retry-after')).toBe('1');
  });

  it('enforces max message size on HTTP (413) and WS (close 1009)', async () => {
    const r = await setup({ limits: { maxMessageBytes: 2048 } });
    const big = m('submit_intent', { goal: 'x', constraints: { rules: Array(10).fill('y'.repeat(200)) } });
    expect((await post(r.gateway.url, big, TOKENS.neko)).status).toBe(413);
    const ws = await rawWs(r.gateway.wsUrl, { authorization: `Bearer ${TOKENS.neko}` });
    ws.send(big);
    await until(() => ws.closed() !== null);
    expect(ws.closed()!.code).toBe(1009);
  });
});

describe('gateway events', () => {
  it('WS push with server-side replay and SDK auto-resume after a dropped connection', async () => {
    const r = await setup();
    r.harness.bindBody(r.body.body);
    const statuses: string[] = [];
    const c = sdk(r.gateway.url, TOKENS.neko, { onStatus: s => statuses.push(s) });
    const welcome = await c.connect();
    expect(welcome).toMatchObject({ agent: 'neko', server: { name: 'agent-mc-harness' } });
    const got: HarnessEvent[] = [];
    await c.subscribe(e => got.push(e), { minSeverity: 1 });
    const { intentId } = await c.submitIntent({ goal: '钓鱼', constraints: { steps } });
    await until(() => got.some(e => e.intentId === intentId && e.text.includes('完成')));

    // Drop the socket; events happen while offline; the SDK reconnects and resumes from its cursor.
    (c as any).ws.close(4000, 'test drop');
    await until(() => statuses.includes('disconnected'));
    death(r.harness, '溺水');
    death(r.harness, '岩浆');
    await until(() => got.filter(e => e.kind === 'death').length === 2, 5000);
    expect(statuses).toContain('reconnecting');
    const seqs = got.map(e => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => seqs[0]! + i)); // contiguous: nothing missed

    // Explicit replay via pull_events, and stream-change detection.
    const replay = await c.pullEvents({ after: seqs[0]! });
    expect(replay.events.map(e => e.seq)).toEqual(seqs.slice(1));
    expect((await c.pullEvents({ after: 999, stream: 'stream_old' })).streamReset).toBe(true);
  });

  it('raw WS: subscribe(after) replays then pushes live; filters by kind; HTTP cannot subscribe', async () => {
    const r = await setup();
    death(r.harness, 'a');
    r.harness.events.emit({ kind: 'skill', severity: 2, text: 'lvl' });
    const ws = await rawWs(r.gateway.wsUrl);
    ws.send(m('hello', { token: TOKENS.cortico }, 'h'));
    expect((await ws.reply('h')).type).toBe('welcome');
    ws.send(m('subscribe', { after: 0, kinds: ['death'] }, 's'));
    const sub = await ws.reply('s');
    expect(sub.payload).toMatchObject({ replay: true, latest: 2 });
    death(r.harness, 'b');
    await until(() => ws.events().length === 2);
    expect(ws.events().map(e => e.text)).toEqual(['死亡：a @ 1,64,2', '死亡：b @ 1,64,2']);
    ws.send(m('unsubscribe', { subscription: sub.payload.subscription }, 'u'));
    expect((await ws.reply('u')).payload.unsubscribed).toBe(true);
    expect((await post(r.gateway.url, m('subscribe'), TOKENS.neko)).body.payload.code).toBe('bad_request');
    ws.send('{"v":1,"id":"x","type":"nope"}');
    expect((await ws.reply('x')).payload.code).toBe('unknown_type');
  });

  it('HTTP fallback: SDK polling, GET /v1/events and SSE with Last-Event-ID', async () => {
    const r = await setup();
    r.harness.bindBody(r.body.body);
    const c = sdk(r.gateway.url, TOKENS.neko, { transport: 'http', pollIntervalMs: 20 });
    await c.connect();
    const got: HarnessEvent[] = [];
    await c.subscribe(e => got.push(e), { minSeverity: 2 });
    const { intentId } = await c.submitIntent({ goal: '砍树', constraints: { steps } });
    await until(() => got.some(e => e.intentId === intentId && e.kind === 'intent_state'));
    expect((await c.getIntent(intentId)).state).toBe('done');
    expect((await c.getSummary({ maxTokens: 120 })).tokens).toBeLessThanOrEqual(120);

    const list = await fetch(`${r.gateway.url}/v1/events?after=0&minSeverity=2`, { headers: { authorization: `Bearer ${TOKENS.neko}` } });
    const body = await list.json() as any;
    expect(body.payload.events.length).toBeGreaterThan(0);
    expect((await fetch(`${r.gateway.url}/v1/events`)).status).toBe(401);

    death(r.harness, 'sse');
    const latest = r.harness.events.latest();
    const ctrl = new AbortController();
    const res = await fetch(`${r.gateway.url}/v1/events/stream?kinds=death`, { signal: ctrl.signal,
      headers: { authorization: `Bearer ${TOKENS.neko}`, 'last-event-id': String(latest - 1) } });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader(); let text = '';
    while (!text.includes('死亡：sse')) text += new TextDecoder().decode((await reader.read()).value);
    expect(text).toContain(`id: ${latest}`);
    ctrl.abort();
  });
});

void GatewayRequestError;
