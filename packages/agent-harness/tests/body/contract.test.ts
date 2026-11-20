/**
 * Shared Body Adapter contract, run against every body (Mineflayer, Numen hosted_body, Numen mcbot, Touhou Little Maid).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTION_VERBS, BODY_EVENT_KINDS, BODY_PROTOCOL, guardBody, HarnessRuntime, paceCategory, type ActionReceipt, type BodyEvent } from '../../src/index.ts';
import { until } from '../helpers.ts';
import { DRIVERS, type BodyDriver } from './drivers.ts';

const SERVER_WARNING = '[系统] 你因自动挖矿被反作弊检测，继续将被临时封禁';

describe.each(DRIVERS)('BodyAdapter contract: %s', (_label, make) => {
  let d: BodyDriver | null = null;
  const open = async () => (d = await make());
  afterEach(async () => { await d?.body.destroy().catch(() => {}); await d?.close(); d = null; });

  it('declares well-formed capabilities (verbs, events, lifecycle, safety)', async () => {
    const { body } = await open();
    await body.spawn();
    const c = body.capabilities();
    expect(c.protocol).toBe(BODY_PROTOCOL);
    expect(c.kind).toBe(body.kind);
    for (const v of Object.keys(c.actions)) expect(ACTION_VERBS).toContain(v);
    for (const e of c.events) expect(BODY_EVENT_KINDS).toContain(e);
    for (const [, s] of Object.entries(c.actions)) { expect(typeof s!.native).toBe('string'); expect(Array.isArray(s!.args)).toBe(true); }
    const names = c.nativeActions.map(n => n.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThan(0);
    expect(c.lifecycle.spawn).toBeTruthy();
    expect(c.events).toContain('death');
    expect(c.events).toContain('action_result');
    expect(c.limits.length).toBeGreaterThan(0);
  });

  it('lifecycle: refuses actions before spawn, ready after spawn with an isolated identity, refuses after destroy', async () => {
    const drv = await open();
    const before = await drv.body.act(drv.supported);
    expect(before.status).toBe('rejected');
    await drv.body.spawn();
    expect(drv.body.lifecycle()).toBe('ready');
    const id = drv.body.identity()!;
    expect(id.kind).toBe(drv.body.kind);
    expect(id.bodyId).toBeTruthy();
    expect(id.scope.realm && id.scope.account && id.scope.agent).toBeTruthy();
    await drv.body.destroy();
    expect(drv.body.lifecycle()).toBe('destroyed');
    expect((await drv.body.act(drv.supported)).status).toBe('rejected');
  });

  it('unsupported verbs and invalid arguments are refused without touching the body', async () => {
    const drv = await open();
    await drv.body.spawn();
    const sent = drv.sent();
    const u = await drv.body.act({ verb: drv.unsupportedVerb, args: {} });
    expect(u.status).toBe('unsupported');
    expect(u.terminal).toBe(true);
    const bad = await drv.body.act(drv.invalid);
    expect(bad.status).toBe('rejected');
    const nat = await drv.body.act({ verb: 'native', name: 'definitely_not_a_native_action', args: {} });
    expect(nat.status).toBe('unsupported');
    expect(drv.sent()).toBe(sent);
  });

  it('executes a supported action; async work ends with action_result and result() reconciles without re-sending', async () => {
    const drv = await open();
    await drv.body.spawn();
    const events: BodyEvent[] = [];
    drv.body.subscribe(e => events.push(e));
    const r = await drv.body.act({ ...drv.supported, requestId: 'contract-1' });
    expect(['completed', 'accepted']).toContain(r.status);
    expect(r.retryAllowed).toBe(false);
    const sent = drv.sent();
    if (r.status === 'accepted') {
      expect(r.terminal).toBe(false);
      await drv.finish();
      await until(() => events.some(e => e.kind === 'action_result' && e.execution?.terminal === true));
    }
    const again = await drv.body.result('contract-1');
    expect(again.status).toBe('completed');
    // idempotent: the same requestId never re-executes
    const dup = await drv.body.act({ ...drv.supported, requestId: 'contract-1' });
    expect(dup.status).toBe('completed');
    expect(drv.sent()).toBe(sent);
    const h = drv.body.health();
    expect(h.counters.actions).toBeGreaterThanOrEqual(2);
    expect(h.connected).toBe(true);
  });

  it('rejects changed arguments or verb without replacing the original receipt', async () => {
    const drv = await open();
    await drv.body.spawn();
    const action = { ...drv.supported, requestId: 'contract-identity' };
    await drv.body.act(action);
    await drv.finish();
    const original = await drv.body.result(action.requestId);
    expect(original.status).toBe('completed');
    const sent = drv.sent();
    for (const other of [
      { ...action, args: action.verb === 'move' ? { ...action.args, x: 9 } : { text: 'another message' } },
      { verb: drv.unsupportedVerb, requestId: action.requestId },
    ]) {
      const conflict = await drv.body.act(other);
      expect(conflict.status).toBe('rejected');
      expect(conflict.text).toContain('request_id_conflict');
    }
    expect(await drv.body.result(action.requestId)).toEqual(original);
    expect(drv.sent()).toBe(sent);
  });

  it('simultaneous matching requests send one operation and keep the original result queryable', async () => {
    const drv = await open();
    await drv.body.spawn();
    const action = { ...drv.supported, requestId: 'contract-in-flight' };
    const reordered = Object.fromEntries(Object.entries(action.args ?? {}).reverse());
    const before = drv.sent();
    const first = drv.body.act(action);
    const duplicate = drv.body.act({ ...action, args: reordered });
    const query = drv.body.result(action.requestId);
    const conflict = drv.body.act({ ...action, args: { ...action.args, changed: true } });
    const [sent, repeated, changed] = await Promise.all([first, duplicate, conflict]);
    expect(['accepted', 'completed']).toContain(sent.status);
    expect(repeated).toMatchObject({ requestId: action.requestId, status: 'unknown', terminal: false, retryAllowed: false });
    expect(await query).toEqual(repeated);
    expect(drv.sent() - before).toBe(1);
    expect(changed.text).toContain('request_id_conflict');
    await drv.finish();
    expect((await drv.body.result(action.requestId)).status).toBe('completed');
  });

  it('queries an uncertain dispatch by its original ID and never adopts another receipt', async () => {
    const drv = await open();
    await drv.body.spawn();
    const action = { ...drv.supported, requestId: 'contract-uncertain' };
    const completed: ActionReceipt = { requestId: action.requestId, verb: action.verb, status: 'completed',
      terminal: true, text: 'done', retryAllowed: false };
    const foreign = { ...completed, requestId: 'different-operation' };
    const transport = drv.body as unknown as {
      doAct: typeof drv.body.act; doResult(id: string): Promise<ActionReceipt | null>;
    };
    const dispatch = vi.spyOn(transport, 'doAct').mockResolvedValue(foreign);
    const query = vi.spyOn(transport, 'doResult').mockResolvedValueOnce(foreign).mockResolvedValueOnce(completed);
    expect(await drv.body.act(action)).toMatchObject({ requestId: action.requestId, status: 'unknown' });
    expect((await drv.body.result(action.requestId)).status).toBe('unknown');
    expect(await drv.body.act(action)).toEqual(completed);
    expect(await drv.body.result(action.requestId)).toEqual(completed);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(query.mock.calls.map(([id]) => id)).toEqual([action.requestId, action.requestId]);
  });

  it('keeps an early native completion when the transport subsequently acknowledges dispatch', async () => {
    const drv = await open();
    await drv.body.spawn();
    const action = { ...drv.supported, requestId: 'contract-early' };
    const transport = drv.body as unknown as {
      doAct: typeof drv.body.act;
      settle(id: string, status: 'completed', text: string): ActionReceipt;
    };
    const events: BodyEvent[] = [];
    drv.body.subscribe(event => events.push(event));
    vi.spyOn(transport, 'doAct').mockImplementationOnce(async () => {
      const done = transport.settle(action.requestId, 'completed', 'native completion');
      return { ...done, status: 'accepted', terminal: false, text: 'queued' };
    });
    const receipt = await drv.body.act(action);
    expect(receipt).toMatchObject({ status: 'completed', verb: action.verb, text: 'native completion' });
    expect(await drv.body.result(action.requestId)).toEqual(receipt);
    expect(events.filter(e => e.kind === 'action_result')).toHaveLength(1);
  });

  it('keeps receipt queries bounded and a missing remote record leaves local requests intact', async () => {
    const drv = await open();
    await drv.body.spawn();
    const transport = drv.body as unknown as { doResult(id: string): Promise<ActionReceipt | null> };
    const query = vi.spyOn(transport, 'doResult').mockImplementation(async id => ({
      requestId: id, status: id.startsWith('missing-') ? 'unknown' : 'completed', verb: 'native',
      text: 'queried', terminal: true, retryAllowed: false,
    }));
    for (let i = 0; i < 501; i++) await drv.body.result(`recorded-${i}`);
    await drv.body.result('recorded-0'); // The oldest had to be looked up again.
    expect(query).toHaveBeenCalledTimes(502);
    for (let i = 0; i < 501; i++) await drv.body.result(`missing-${i}`);
    await drv.body.result('recorded-0');
    expect(query).toHaveBeenCalledTimes(1003);
  });

  it('reports death as a severity-3 perception event and a snapshot of what it can observe', async () => {
    const drv = await open();
    await drv.body.spawn();
    const events: BodyEvent[] = [];
    drv.body.subscribe(e => events.push(e));
    const snap = await drv.body.snapshot();
    expect(Number.isFinite(Date.parse(snap.sampledAt))).toBe(true);
    const caps = drv.body.capabilities();
    if (caps.snapshot.includes('position')) expect(snap.position === null || typeof snap.position.x === 'number').toBe(true);
    await drv.kill();
    await until(() => events.some(e => e.kind === 'death'));
    const death = events.find(e => e.kind === 'death')!;
    expect(death.severity).toBe(3);
    expect(death.bodyKind).toBe(drv.body.kind);
  });

  it('safety: a server anti-cheat warning halts motion (stop requested), read-only actions still work', async () => {
    const drv = await open();
    const guard = guardBody(drv.body);
    await guard.spawn();
    const events: BodyEvent[] = [];
    guard.subscribe(e => events.push(e));
    // a player quoting the words must not trip it
    guard.feedServerText('<Bob> 听说反作弊会检测');
    expect(guard.health().safety?.halted).toBe(false);
    await drv.serverWarning(guard, SERVER_WARNING);
    await until(() => events.some(e => e.kind === 'safety'));
    expect(guard.health().safety?.halted).toBe(true);
    const blocked = await guard.act(drv.motion);
    expect(blocked.status).toBe('blocked_by_safety');
    if (guard.capabilities().actions.observe) expect(['completed', 'accepted']).toContain((await guard.act({ verb: 'observe' })).status);
    guard.clearHalt();
    expect(guard.health().safety?.halted).toBe(false);
  });

  it('safety: pace limits refuse bursts with retryAfterMs', async () => {
    const drv = await open();
    const cat = drv.supported.verb === 'native' ? 'motion' : paceCategory(drv.supported.verb);
    const guard = guardBody(drv.body, { pace: { [cat]: { perMinute: 1, burst: 1 } } });
    await guard.spawn();
    expect(['completed', 'accepted']).toContain((await guard.act({ ...drv.supported, requestId: 'pace-0001' })).status);
    const second = await guard.act({ ...drv.supported, requestId: 'pace-0002' });
    expect(second.status).toBe('blocked_by_safety');
    expect(second.retryAfterMs).toBeGreaterThan(0);
  });

  it('harness drives it through the unified interface; unsupported steps go back to the host', async () => {
    const drv = await open();
    const guard = guardBody(drv.body);
    await guard.spawn();
    const harness = new HarnessRuntime({ self: guard.identity()?.name ?? 'self' });
    harness.attachBody(guard);
    const step = drv.supported.verb === 'native' ? `body:native:${drv.supported.name}` : `body:${drv.supported.verb}`;
    const ok = await harness.submitIntent({ goal: 'contract step', constraints: { steps: [{ tool: step, args: drv.supported.args ?? {} }] } });
    const finishing = setInterval(() => void drv.finish(), 30);
    try { await until(() => harness.getIntent(ok.intentId)!.state === 'done', 4000); } finally { clearInterval(finishing); }
    const no = await harness.submitIntent({ goal: 'impossible', constraints: { steps: [{ tool: `body:${drv.unsupportedVerb}`, args: {} }] } });
    await until(() => harness.getIntent(no.intentId)!.state === 'paused');
    expect(harness.getIntent(no.intentId)!.reason).toMatch(/not supported/);
    await drv.kill();
    await until(() => harness.pullEvents({ after: 0 }).events.some(e => e.kind === 'death'));
    expect((await harness.getSummary()).text).toContain(`身体：${drv.body.kind}`);
    await harness.close();
  });
});
