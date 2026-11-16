import { describe, expect, it } from 'vitest';
import { buildSummary, classifyBodyEvent, estimateTokens, EventHub, IntentManager, truncateToTokens } from '../src/index.ts';

describe('summary budget', () => {
  it('never exceeds the budget and keeps the most important sections first', () => {
    const m = new IntentManager();
    const active = m.submit({ goal: '去钓鱼并挂机直到天黑'.repeat(3), priority: 'high' });
    m.transition(active.id, 'active', { plan: [{ tool: 'mc_do', args: {} }], stepIndex: 0 });
    const queued = Array.from({ length: 10 }, (_, i) => m.submit({ goal: `排队任务${i} 收集木头和石头`.repeat(2) }));
    const hub = new EventHub();
    for (let i = 0; i < 20; i++) hub.emit({ kind: 'interaction', severity: 3, text: `[MC 私聊] Steve: 第${i}条消息，内容比较长，用来测试摘要预算是否被严格执行。` });
    const facts = Array.from({ length: 30 }, (_, i) => `Steve HOME_AT home:base${i}=${i},64,${i}（2026-11-0${i % 9 + 1}起）`);
    for (const maxTokens of [80, 150, 300, 800, 5000, 1]) {
      const s = buildSummary({ maxTokens, now: new Date('2026-11-16T13:00:00Z'), executor: 'running', active: m.active(),
        queued: m.list({ states: ['queued'], limit: 3 }), paused: [], events: hub.recent(5), facts });
      expect(s.tokens).toBeLessThanOrEqual(s.budget);
      expect(estimateTokens(s.text)).toBe(s.tokens);
      expect(s.text).toContain('当前意图');
      expect(s.truncated).toBe(true);
    }
    expect(buildSummary({ maxTokens: 5000, now: new Date(), executor: 'idle', active: null, queued: [], paused: [], events: [], facts: [] }).budget).toBe(800);
    void queued;
  });

  it('truncateToTokens respects the estimate', () => {
    const t = truncateToTokens('这是一个很长的中文句子'.repeat(20), 30);
    expect(estimateTokens(t)).toBeLessThanOrEqual(30);
    expect(t.endsWith('…')).toBe(true);
    expect(truncateToTokens('short', 30)).toBe('short');
  });
});

describe('key events', () => {
  it('classifies body events conservatively', () => {
    const ts = '2026-11-16T12:00:00Z';
    expect(classifyBodyEvent({ type: 'minecraft.event', ts, text: '你死了', meta: { death: { position: { x: 1.5, y: 64, z: -2.5 }, cause: { text: '摔死' } } } }, 'Komi'))
      .toMatchObject({ kind: 'death', severity: 3, text: '死亡：摔死 @ 1,64,-3' });
    expect(classifyBodyEvent({ type: 'minecraft.task', ts, text: 'x', execution: { kind: 'task', id: 't', phase: 'blocked', terminal: true } }, 'Komi'))
      .toMatchObject({ kind: 'task_failed', severity: 3 });
    expect(classifyBodyEvent({ type: 'minecraft.event', ts, text: '[Minecraft] 升到 7 级了。' }, 'Komi')).toMatchObject({ kind: 'skill', data: { level: 7 } });
    expect(classifyBodyEvent({ type: 'minecraft.chat', ts, text: '[MC 私聊] Steve: 来帮我', meta: { uname: 'Steve' } }, 'Komi')).toMatchObject({ kind: 'interaction', severity: 3 });
    expect(classifyBodyEvent({ type: 'minecraft.chat', ts, text: '[MC] Steve: 大家好', meta: { uname: 'Steve' } }, 'Komi')).toBeNull();
    expect(classifyBodyEvent({ type: 'minecraft.chat', ts, text: '[MC] Komi: Komi here', meta: { uname: 'Komi' } }, 'Komi')).toBeNull();
    expect(classifyBodyEvent({ type: 'minecraft.world.snapshot', ts, text: 'x' }, 'Komi')).toBeNull();
  });

  it('push and pull share one bounded cursor stream; listeners are isolated', async () => {
    const hub = new EventHub(3);
    const got: number[] = [];
    hub.subscribe(() => { throw new Error('bad host'); });
    const off = hub.subscribe(e => got.push(e.seq), 2);
    for (let i = 0; i < 5; i++) hub.emit({ kind: 'skill', severity: i % 2 ? 2 : 1, text: `e${i}` });
    await new Promise(r => setTimeout(r, 0));
    expect(got).toEqual([2, 4]);
    off();
    const p = hub.pull(0, 10);
    expect(p.events.map(e => e.seq)).toEqual([3, 4, 5]);
    expect(p.dropped).toBe(true);
    expect(hub.pull(4, 10)).toMatchObject({ latest: 5, dropped: false });
    expect(hub.pull(0, 10, 2).events.map(e => e.seq)).toEqual([4]);
  });
});
