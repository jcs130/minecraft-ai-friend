import { expect, it } from 'vitest';
import { MinecraftWorld } from '../core/world.ts';
import { MINECRAFT_DEFAULTS } from '../core/config.ts';
import { FakeHost } from './method-host.ts';
class ChatWorld extends MinecraftWorld {
  notice(text: string, meta?: Record<string, unknown>) { this.emit('minecraft.chat', text, false, { trigger: 'piggyback', meta }); }
}
it('distinguishes server chat transport from named players and outgoing private echoes', () => {
  const world = new ChatWorld({ cfg: structuredClone(MINECRAFT_DEFAULTS) }), host = new FakeHost();
  Object.assign(world, { host });
  world.notice('Room state: five enemies.');
  world.notice('I can help.', { uname: 'Companion', channel: 'private' });
  world.notice('Sent to Companion.', { outgoing: true, direction: 'outgoing', channel: 'private' });
  expect(host.events[0].meta).toEqual({ channel: 'system' });
  expect(host.events[1].meta).toMatchObject({ uname: 'Companion', channel: 'private' });
  expect(host.events[2].meta).toMatchObject({ outgoing: true, direction: 'outgoing', channel: 'private' });
  expect(host.events.map(e => e.text)).toEqual(['Room state: five enemies.', 'I can help.', 'Sent to Companion.']);
});
