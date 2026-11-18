import { describe, expect, it } from 'vitest';
import { AgentMemory, createMinecraftMemory, memoryConfigFromEnv, withAgentMemory } from '../src/index.ts';
import { SCOPE } from './helpers.ts';

const facts = { world: { key: 'minecraft:overworld', revision: 1 }, experience: { scope: SCOPE } };
const tool = (i: ReturnType<typeof createMinecraftMemory>, name: string) => i.tools.find(t => t.name === name)!;

describe('memory tools and opt-in wiring', () => {
  it('is off by default and leaves client options untouched', () => {
    expect(memoryConfigFromEnv({}).enabled).toBe(false);
    const options = { cfg: { username: 'Komi' }, dataDir: '/tmp/x' };
    const r = withAgentMemory(options, memoryConfigFromEnv({}));
    expect(r.options).toBe(options);
    expect(r.integration).toBeNull();
    const cfg = memoryConfigFromEnv({ AGENT_MEMORY_ENABLED: '1', AGENT_MEMORY_BACKEND: 'hybrid', AGENT_MEMORY_GRAPHITI_TOKEN_ENV: 'bad name' });
    expect(cfg).toMatchObject({ enabled: true, backend: 'hybrid', graphitiUrl: 'http://127.0.0.1:8765' });
    expect(cfg.graphitiTokenEnv).toBeUndefined();
  });

  it('enabled wiring appends one observer and the memory tools', async () => {
    const r = withAgentMemory({ cfg: { username: 'Komi' }, dataDir: '/unused', eventObservers: [() => {}] },
      { enabled: true, backend: 'local', graphitiUrl: 'http://127.0.0.1:8765', dataDir: ':memory:' });
    expect(r.options.eventObservers).toHaveLength(2);
    expect(((r.options as { extraTools: readonly unknown[] }).extraTools as { name: string }[]).map(t => t.name)).toEqual(['memory_query', 'memory_recall_at', 'memory_recent', 'memory_remember']);
    await r.integration!.close();
  });

  it('captures back-to-back changes of scope and clears an unknown identity', async () => {
    const m = new AgentMemory({ dataDir: ':memory:' });
    const i = createMinecraftMemory({ memory: m, self: 'helper' });
    const other = { ...SCOPE, realm: 'other-realm' };
    let active: typeof facts | null = facts;
    const lazy = () => active;
    const event = (cursor: number) => ({ type: 'minecraft.enter', ts: '2026-11-16T12:00:00Z', cursor, text: 'Pilot joined', meta: { uname: 'Pilot' } });
    i.observer(event(1), lazy);
    active = { experience: { scope: other }, world: { key: 'other:world', revision: 2 } };
    i.observer(event(2), lazy);
    active = null;
    i.observer(event(3), lazy);
    await i.idle();
    expect(m.scope(SCOPE).recentEpisodes().map(e => e.source.ref)).toEqual(['cursor:1']);
    expect(m.scope(other).recentEpisodes().map(e => [e.source.ref, e.world?.key])).toEqual([['cursor:2', 'other:world']]);
    expect((await tool(i, 'memory_recent').handler({})).failed).toBe(true);
    await i.close();
  });

  it('observer ingests host events under the observed scope; tools read and write', async () => {
    const i = createMinecraftMemory({ memory: new AgentMemory({ dataDir: ':memory:' }), self: 'Komi' });
    expect((await tool(i, 'memory_query').handler({})).failed).toBe(true); // no scope yet
    i.observer({ type: 'minecraft.chat', ts: '2026-11-01T00:00:00Z', text: '[MC 私聊] Steve: 我喜欢红石', meta: { uname: 'Steve' } }, facts);
    expect(() => i.observer({ type: 'minecraft.chat', ts: 'not a time', text: '[MC] Steve: 我喜欢x', meta: { uname: 'Steve' } }, facts)).not.toThrow();
    let reads = 0;
    const lazy = () => { reads++; return facts; };
    i.observer({ type: 'minecraft.world.snapshot', ts: '2026-11-01T00:00:00Z', text: 'snapshot' }, lazy);
    i.observer({ type: 'minecraft.leave', ts: '2026-11-01T01:00:00Z', text: 'Steve left', meta: { uname: 'Steve' } }, lazy);
    i.observer({ type: 'minecraft.enter', ts: '2026-11-01T02:00:00Z', text: 'Steve joined', meta: { uname: 'Steve' } }, lazy);
    expect(reads).toBe(2); // the snapshot is skipped; each stored event resolves its scope once
    await i.idle();
    expect(i.current()!.memory.episodeCount()).toBe(3);
    const q = await tool(i, 'memory_query').handler({ entity: 'Steve' });
    expect(q.text).toContain('LIKES 红石');
    const rem = await tool(i, 'memory_remember').handler({ text: 'Steve moved his base', speaker: 'Steve',
      fact: { subject: 'Player:Steve', relation: 'home_at', object: 'Location:minecraft:overworld|home:main', value: '100,64,100', valid_at: '2026-11-02T00:00:00Z' } });
    expect(rem.failed).toBeUndefined();
    await tool(i, 'memory_remember').handler({ text: 'moved again',
      fact: { subject: 'Player:Steve', relation: 'HOME_AT', object: 'Location:minecraft:overworld|home:main', value: '300,64,300', valid_at: '2026-11-05T00:00:00Z' } });
    const at = await tool(i, 'memory_recall_at').handler({ at: '2026-11-03T00:00:00Z', relation: 'HOME_AT' });
    expect(at.text).toContain('100,64,100');
    expect(at.text).not.toContain('300,64,300');
    const recent = await tool(i, 'memory_recent').handler({ kinds: ['note'] });
    expect(recent.text).toContain('Steve reported: Steve moved his base');
    expect((await tool(i, 'memory_remember').handler({ text: 'x', fact: { subject: 'Nope:x', relation: 'R' } })).failed).toBe(true);
    expect((await tool(i, 'memory_recall_at').handler({ at: 'yesterday' })).failed).toBe(true);
    await i.close();
  });
});
