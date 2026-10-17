import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { MinecraftWorld } from '../core/world.ts';
import { MinecraftWorldProxy } from '../core/proxy.ts';
import { MINECRAFT_CLIENT_DEFAULTS } from '../src/client/config.ts';
const row = { id: 'call-1', at: '2026-10-17T17:00:00Z', kind: 'tool', source: 'system2', status: 'accepted', title: '查看背包', arguments: { password: 'private' } };
describe('shared host activity port', () => {
  it('validates and redacts records before IPC without spawning or dispatching tools', () => {
    const sent: unknown[] = [], world = new MinecraftWorldProxy({ cfg: structuredClone(MINECRAFT_CLIENT_DEFAULTS) });
    Object.assign(world, { child: { connected: true, send: (value: unknown) => sent.push(value) } });
    world.publishAgentActivity({ ...row, kind: 'prompt' }); expect(sent).toHaveLength(0);
    world.publishAgentActivity(row); expect(sent).toHaveLength(1); expect(JSON.stringify(sent[0])).not.toContain('private');
    expect((sent[0] as any).cast.kind).toBe('viewer-activity'); expect((sent[0] as any).cast.value.status).toBe('accepted');
  });
  it('feeds only the actual bot observer and does not mutate the body', () => {
    const bot = new EventEmitter(), records: any[] = [];
    bot.on('viewer:activity', value => records.push(value));
    const world = new MinecraftWorld({ cfg: structuredClone(MINECRAFT_CLIENT_DEFAULTS) }); Object.assign(world, { bridge: { bot } });
    world.publishAgentActivity(row); expect(records).toHaveLength(1); expect(records[0].arguments.password).toBe('[已隐藏]');
    world.publishAgentActivity({ ...row, at: 'unknown' }); expect(records).toHaveLength(1);
  });
});
