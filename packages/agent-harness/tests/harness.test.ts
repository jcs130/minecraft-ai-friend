import { describe, expect, it } from 'vitest';
import { AgentMemory, createMinecraftMemory } from 'agent-mc-memory';
import { HarnessRuntime, type HarnessEvent, type Reflector } from '../src/index.ts';
import { doStep, fakeBody, terminal, tick, until } from './helpers.ts';

const harness = (extra: Partial<ConstructorParameters<typeof HarnessRuntime>[0]> = {}) => new HarnessRuntime({ self: 'Komi', ...extra });

describe('HarnessRuntime intent lifecycle', () => {
  it('without a body intents stay queued; summary says so', async () => {
    const h = harness();
    const { intentId, state } = await h.submitIntent({ goal: '钓鱼', constraints: { steps: [doStep('fish')] } });
    await tick();
    expect(state).toBe('queued');
    expect(h.getIntent(intentId)!.state).toBe('queued');
    expect((await h.getSummary()).text).toContain('未连接身体');
    await h.close();
  });

  it('runs explicit steps, waits for async task receipts and pushes events', async () => {
    const h = harness();
    const pushed: HarnessEvent[] = [];
    h.subscribe(e => pushed.push(e), { minSeverity: 2 });
    const f = fakeBody();
    h.bindBody(f.body);
    const { intentId } = await h.submitIntent({ goal: '做钓竿然后钓鱼', priority: 'high', constraints: { steps: [doStep('craft'), doStep('fish')] } });
    await until(() => f.calls.length === 1);
    expect(h.getIntent(intentId)!.state).toBe('active');
    h.observer(terminal(f.lastTask()), null);
    await until(() => f.calls.length === 2);
    expect(h.getIntent(intentId)!.stepIndex).toBe(1);
    h.observer(terminal(f.lastTask()), null);
    await until(() => h.getIntent(intentId)!.state === 'done');
    await tick();
    expect(pushed.map(e => e.kind)).toEqual(['task_completed', 'task_completed', 'intent_state']);
    expect(pushed.at(-1)!.text).toContain('意图完成');
    expect(h.pullEvents({ minSeverity: 1 }).events.some(e => e.text.includes('开始执行'))).toBe(true);
    await h.close();
  });

  it('free-text goal pauses for the host; update with steps + resume completes it', async () => {
    const h = harness(); const f = fakeBody({ sync: true }); h.bindBody(f.body);
    const { intentId } = await h.submitIntent({ goal: '去村庄看看' });
    await until(() => h.getIntent(intentId)!.state === 'paused');
    expect(h.getIntent(intentId)!.reason).toMatch(/No planner/);
    expect(h.pullEvents({ minSeverity: 3 }).events.at(-1)).toMatchObject({ kind: 'intent_state', data: { needsHost: true } });
    await h.updateIntent(intentId, { constraints: { steps: [doStep('goto_village')] } });
    await h.resume(intentId);
    await until(() => h.getIntent(intentId)!.state === 'done');
    expect(f.calls.map(c => c.tool)).toEqual(['mc_do']);
    await h.close();
  });

  it('rejects non-allow-listed tools', async () => {
    const h = harness(); h.bindBody(fakeBody().body);
    const { intentId } = await h.submitIntent({ goal: 'x', constraints: { steps: [{ tool: 'mc_admin_op', args: {} }] } });
    await until(() => h.getIntent(intentId)!.state === 'paused');
    expect(h.getIntent(intentId)!.reason).toMatch(/not allowed/);
    await h.close();
  });

  it('failed steps fail the intent; cancel stops the body; urgent intents preempt', async () => {
    const failing = harness(); failing.bindBody(fakeBody({ fail: 'mc_do' }).body);
    const r = await failing.submitIntent({ goal: 'mine', constraints: { steps: [doStep('dig')] } });
    await until(() => failing.getIntent(r.intentId)!.state === 'failed');
    expect(failing.getIntent(r.intentId)!.reason).toMatch(/cannot do that/);
    await failing.close();

    const h = harness(); const f = fakeBody(); h.bindBody(f.body);
    const slow = await h.submitIntent({ goal: '慢任务', constraints: { steps: [doStep('build')] } });
    await until(() => h.getIntent(slow.intentId)!.state === 'active' && f.calls.length === 1);
    const urgent = await h.submitIntent({ goal: '逃跑', priority: 'urgent', constraints: { steps: [doStep('escape')] } });
    await until(() => h.getIntent(urgent.intentId)!.state === 'active');
    expect(h.getIntent(slow.intentId)).toMatchObject({ state: 'queued', reason: expect.stringMatching(/preempted/) });
    expect(f.calls.map(c => c.tool)).toEqual(['mc_do', 'mc_stop', 'mc_do']);
    await h.cancel(urgent.intentId);
    expect(h.getIntent(urgent.intentId)!.state).toBe('cancelled');
    await until(() => h.getIntent(slow.intentId)!.state === 'active');
    await h.pause(slow.intentId, 'host wants to chat');
    expect(h.getIntent(slow.intentId)).toMatchObject({ state: 'paused', reason: 'host wants to chat' });
    expect(f.calls.filter(c => c.tool === 'mc_stop')).toHaveLength(3);
    await h.close();
  });

  it('global pause holds the queue until resume', async () => {
    const h = harness(); const f = fakeBody({ sync: true }); h.bindBody(f.body);
    await h.pause();
    const { intentId } = await h.submitIntent({ goal: 'eat', constraints: { steps: [doStep('eat')] } });
    await tick(); await tick();
    expect(h.getIntent(intentId)!.state).toBe('queued');
    expect((await h.getSummary()).text).toContain('已暂停');
    await h.resume();
    await until(() => h.getIntent(intentId)!.state === 'done');
    await h.close();
  });

  it('memory wiring: body events reach cold log + graph and show up in topic summaries; reflection hook runs async', async () => {
    const memory = createMinecraftMemory({ self: 'Komi', memory: new AgentMemory({ dataDir: ':memory:' }) });
    const reflections: string[] = [];
    const reflector: Reflector = { reflect: async t => ({ summary: `${t.kind}: 下次带食物` }) };
    const h = harness({ memory, reflector, hostMemory: { write: async n => { reflections.push(n.summary); } } });
    const facts = { world: { key: 'minecraft:overworld', revision: 1 }, experience: { scope: { realm: 'r', account: 'offline:Komi', agent: 'komi' } } };
    h.observer({ type: 'minecraft.chat', ts: '2026-11-16T12:00:00Z', text: '[MC 私聊] Steve: 我最喜欢红石了', meta: { uname: 'Steve' } }, () => facts);
    h.observer({ type: 'minecraft.event', ts: '2026-11-16T12:05:00Z', text: '[Minecraft] 你死了', meta: { death: { position: { x: 3, y: 60, z: 4 }, cause: { text: '被苦力怕炸死' } } } }, () => facts);
    await h.idle();
    expect(memory.current()!.memory.episodeCount()).toBe(2);
    const s = await h.getSummary({ topic: 'Steve 红石' });
    expect(s.text).toContain('Steve LIKES 红石');
    expect(s.text).toContain('死亡：被苦力怕炸死');
    expect(s.text).toContain('[MC 私聊] Steve');
    expect(reflections).toEqual(['death: 下次带食物']);
    expect(h.pullEvents().events.map(e => e.kind)).toEqual(['interaction', 'death', 'reflection']);
    await h.close();
  });
});
