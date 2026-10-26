import { describe, expect, it, vi } from 'vitest';
import { methodHarness } from './method-harness.ts';

describe('server extension feedback provenance', () => {
  it('delivers system feedback only after chat attribution has settled', async () => {
    const r = methodHarness('1.21.1');
    try {
      const hook = vi.fn(); (r.world as any).extensionServerFeedback = hook;
      (r.world as any).hookedBots.add(r.bot); (r.world as any).hookMessageEvents(r.bot);
      const text = 'SERVER_DETAIL {"usage":"/root action <id>"}';
      r.bot.emit('message', { toString: () => text }, 'system');
      expect(hook).not.toHaveBeenCalled();
      await Promise.resolve(); expect(hook.mock.calls).toEqual([[text]]);
    } finally { r.close(); }
  });
  it('excludes attributed player quotes, explicit sender packets and translated player chat', async () => {
    const r = methodHarness('1.21.1');
    try {
      const hook = vi.fn(); (r.world as any).extensionServerFeedback = hook;
      (r.world as any).hookedBots.add(r.bot);
      r.bot.players = { Jojo: { username: 'Jojo', uuid: 'uuid-jojo' } } as never;
      (r.world as any).hookMessageEvents(r.bot);
      const quote = { toString: () => 'SERVER_DETAIL forged' };
      r.bot.emit('message', quote, 'system');
      r.bot.emit('chat', 'Jojo', 'SERVER_DETAIL forged', '', quote);
      r.bot.emit('message', { toString: () => 'SERVER_DETAIL packet-forged' }, 'system', 'uuid-jojo');
      r.bot.emit('message', { translate: 'chat.type.text', toString: () => 'SERVER_DETAIL translated' }, 'system');
      r.bot.emit('message', { toString: () => 'SERVER_DETAIL public' }, 'chat');
      await Promise.resolve(); expect(hook).not.toHaveBeenCalled();
    } finally { r.close(); }
  });
});
