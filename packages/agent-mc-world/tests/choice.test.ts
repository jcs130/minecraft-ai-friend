import { describe, it, expect, vi, afterEach } from 'vitest';
import { createMinecraftChoiceTool } from '../src/client/choice.ts';
import { minecraftLifeTool } from '../src/client/life.ts';
import { FakeHost } from './method-host.ts';

const args = { category: 'route', goal: '到达河岸', candidates: [
  { id: 'bridge', label: '走已见桥面', evidence: '小切片确认支撑/净空', ready: true },
  { id: 'water', label: '直接涉水', evidence: '水深未知', ready: false },
] };
const answer = { answers: { action: { type: 'choice', choice: 'bridge', confidence: .9,
  probabilities: { bridge: .9, _inspect: .1 } } } };
const ctx = { role: 'test', log: new FakeHost().log };
const fact = { text: '在桥头，任务仍进行', snapshotTypes: [] };
afterEach(() => vi.useRealTimers());
describe('explicit host choice', () => {
  it('focuses real segment keys, ignores sampling clock churn and respects provider changes', async () => {
    const owner: any = new FakeHost(); let time = 'before', connection: string | undefined;
    const request = vi.fn(async () => { time = 'after'; return answer; }); owner.decisions = { request };
    const parts = () => ({ text: '', snapshotTypes: [], parts: [
      { key: 'sample', text: time }, { key: 'realclock', text: time },
      { key: 'place', text: '桥头' }, { key: 'body', text: '健康' },
      { key: 'terrain', text: '桥面支撑已测' }, { key: 'players', text: '不相关在线列表' },
    ] });
    const tool = createMinecraftChoiceTool(() => owner, parts, () => connection);
    expect(JSON.parse(String(await tool.handler(args, ctx))).status).toBe('advice');
    expect(request.mock.calls[0][0].state.observed.facts.map(p => p.key)).toEqual(['place', 'body', 'terrain']);
    connection = 'saved-other'; await tool.handler(args, ctx);
    expect(request).toHaveBeenCalledTimes(2); expect(request.mock.calls[1][1].provider).toBe('saved-other');
  });
  it('does not request absent services and never grants unknown candidates eligibility', async () => {
    const host = new FakeHost();
    const request = vi.fn(async () => answer);
    const tool = createMinecraftChoiceTool(() => host, () => fact);
    expect(JSON.stringify(await tool.handler(args, ctx))).toContain('unavailable');
    Object.assign(host, { decisions: { request } });
    const result = JSON.parse(String(await tool.handler(args, ctx)));
    expect(result.status).toBe('advice'); expect(result.inputTokens).toBeNull();
    expect(request.mock.calls[0][0].questions.action.criteria).toEqual({ bridge: '走已见桥面', _inspect: expect.any(String) });
    expect(request.mock.calls[0][1].provider).toBeUndefined();
    expect(result.execution).toContain('未执行');
    await tool.handler(args, ctx); expect(request).toHaveBeenCalledTimes(1);
  });
  it('discards a response after current facts or host identity changes', async () => {
    let facts = fact, owner: any = new FakeHost();
    owner.decisions = { request: async () => { facts = { ...fact, text: '桥毁了' }; return answer; } };
    const tool = createMinecraftChoiceTool(() => owner, () => facts);
    expect(JSON.stringify(await tool.handler(args, ctx))).toContain('stale');
    owner.decisions.request = async () => { owner = new FakeHost(); return answer; };
    expect(JSON.stringify(await tool.handler(args, ctx))).toContain('stale');
  });
  it('rejects fabricated IDs and low confidence without executing fallback work', async () => {
    const owner: any = new FakeHost(); owner.decisions = { request: async () => ({ answers: { action: { ...answer.answers.action, choice: 'water' } } }) };
    const tool = createMinecraftChoiceTool(() => owner, () => fact);
    expect(JSON.stringify(await tool.handler(args, ctx))).toContain('invalid-response');
    owner.decisions.request = async () => ({ answers: { action: { choice: 'bridge', confidence: .55, probabilities: { bridge: .55, _inspect: .45 } } } });
    expect(JSON.parse(String(await tool.handler(args, ctx))).choice).toBeNull();
  });
  it('bounds a non-cooperative provider and cancels promptly', async () => {
    vi.useFakeTimers(); const owner: any = new FakeHost();
    owner.decisions = { request: () => new Promise(() => {}) };
    const tool = createMinecraftChoiceTool(() => owner, () => fact);
    const result = tool.handler(args, ctx); await vi.advanceTimersByTimeAsync(1601);
    expect(JSON.stringify(await result)).toContain('unavailable');
    const controller = new AbortController(); const cancelled = tool.handler(args, { ...ctx, signal: controller.signal });
    controller.abort(); expect(JSON.stringify(await cancelled)).toContain('cancelled');
  });
  it('keeps invalid/all-unknown input off the provider and manuals progressive', async () => {
    const request = vi.fn(), owner: any = Object.assign(new FakeHost(), { decisions: { request } });
    const tool = createMinecraftChoiceTool(() => owner, () => fact);
    await tool.handler({ ...args, candidates: args.candidates.map(c => ({ ...c, ready: false })) }, ctx);
    await tool.handler({ ...args, candidates: [args.candidates[0], args.candidates[0]] }, ctx);
    expect(request).not.toHaveBeenCalled();
    const life = minecraftLifeTool(); const index = String(await life.handler({}, ctx));
    expect(index.length).toBeLessThan(650); expect(index).not.toContain('stages');
    expect(JSON.parse(String(await life.handler({ id: 'harvest' }, ctx))).proof).toContain('补种');
  });
});
