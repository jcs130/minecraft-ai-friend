import { afterEach, describe, expect, it, vi } from 'vitest';
import { methodHarness } from './method-harness.ts';
import { ServerFeedbackLedger } from '../core/server-feedback.ts';

afterEach(() => vi.useRealTimers());
const denial = 'MC_LAND_ACCESS {"status":"deny","allowed":false,"reason":"land_permission_denied","action":"place","x":-486,"y":67,"z":-506}';

describe('server feedback remains available after the event page', () => {
  it.each(['system', 'action_bar', 'system_chat', 'game_info'] as const)('retains an actual %s denial in fresh facts', async channel => {
    const r = methodHarness('1.21.1');
    try {
      (r.world as any).hookedBots.add(r.bot);
      (r.world as any).hookMessageEvents(r.bot);
      const component = { toString: () => denial };
      if (channel === 'action_bar') r.bot._client.emit(channel, { text: denial });
      else if (channel === 'system_chat') r.bot._client.emit(channel, { content: denial, isActionBar: true });
      else r.bot.emit('message', component, channel);
      await Promise.resolve();
      const feedback = r.world.requestFacts()!.parts!.find(part => part.key === 'serverFeedback');
      expect(feedback?.text).toContain('land_permission_denied');
      expect(feedback?.text).toContain('-486');
    } finally { r.close(); }
  });

  it('retains the server reason in the matching failed task receipt, not another task', async () => {
    const r = methodHarness('1.21.1');
    try {
      (r.world as any).hookedBots.add(r.bot);
      Object.defineProperty(r.exec, 'currentTask', { value: { id: 7 } });
      (r.world as any).hookMessageEvents(r.bot);
      r.bot.emit('message', { toString: () => denial }, 'system');
      await Promise.resolve();
      (r.world as any).onTaskReport({ kind: 'blocked', taskId: 7, text: '服务端未确认放置' });
      expect(r.host.events.at(-1)?.execution?.evidence?.receipt).toContain('land_permission_denied');
      (r.world as any).onTaskReport({ kind: 'blocked', taskId: 8, text: 'another task' });
      expect(r.host.events.at(-1)?.text).not.toContain('land_permission_denied');
    } finally { r.close(); }
  });

  it('deduplicates raw and high-level action bars and keeps full original error text', async () => {
    const r = methodHarness('1.21.1');
    try {
      (r.world as any).hookedBots.add(r.bot);
      (r.world as any).hookMessageEvents(r.bot);
      r.bot._client.emit('action_bar', { text: denial });
      r.bot.emit('message', { toString: () => denial }, 'game_info');
      await Promise.resolve();
      expect(r.host.events.filter(row => row.text.includes(denial))).toHaveLength(1);
      expect(r.world.requestFacts()!.parts!.find(p => p.key === 'serverFeedback')!.text.split(denial).length).toBeLessThanOrEqual(2);
    } finally { r.close(); }
  });

  it('bounds feedback, ignores ordinary HUD, expires and clears on a new connection', () => {
    const ledger = new ServerFeedbackLedger();
    expect(ledger.note('生命20/20 | 魔法值24/24', 'actionBar', null, 1000)).toBe(false);
    for (let i = 0; i < 10; i++) ledger.note(`Denied operation ${i}`, 'system', 7, 1000 + i);
    const first = ledger.read(1020)!;
    expect(first).not.toContain('operation 6');
    expect(first).toContain('operation 7');
    expect(ledger.note('Denied operation 9', 'actionBar', 7, 2000)).toBe(false);
    expect(ledger.read(2000)).toBe(first);
    expect(ledger.forTask(8, 2000)).toBe('');
    expect(ledger.read(700_000)).toBeNull();
    ledger.note('Failed again', 'system', 7, 700_001);
    ledger.clear();
    expect(ledger.read(700_002)).toBeNull();
  });

  it('does not label a player quoting an error as a server rejection', async () => {
    const r = methodHarness('1.21.1');
    try {
      (r.world as any).hookedBots.add(r.bot);
      r.bot.players = { Jojo: { username: 'Jojo', uuid: 'uuid-jojo' } } as never;
      (r.world as any).hookMessageEvents(r.bot);
      const message = { toString: () => '<Jojo> Denied: I was quoting an error' };
      r.bot.emit('message', message, 'system');
      r.bot.emit('chat', 'Jojo', 'Denied: I was quoting an error', '', message);
      await Promise.resolve();
      expect(r.world.requestFacts()!.parts!.find(p => p.key === 'serverFeedback')).toBeUndefined();
    } finally { r.close(); }
  });
});
