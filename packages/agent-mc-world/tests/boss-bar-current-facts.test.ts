import { describe, expect, it, vi } from 'vitest';
import { methodHarness } from './method-harness.ts';
import { structuredVisual } from '../src/client/visual.ts';
import { bossBarChange, EventCondenser, readBossBarHud, type BossBarReading } from '../src/client/index.ts';

describe('event admission for one observer', () => {
  const read = (title: string, id = 'a', progress = 0.4): BossBarReading => ({ title, id, progress, kind: 'status' });
  it('keeps a watched deadline and a timer reset, while preserving objective and coordinate changes', () => {
    const countdown = (t: string) => read('采集 1/5｜剩余约' + t);
    expect(bossBarChange(countdown('03:00'), countdown('02:50'))).toBeNull();
    expect(bossBarChange(countdown('00:20'), countdown('00:10'))).toBe('deadline');
    expect(bossBarChange(countdown('02:50'), countdown('02:40'), 160)).toBe('deadline');
    expect(bossBarChange(countdown('00:20'), countdown('03:00'))).toBe('timer-restarted');
    expect(bossBarChange(countdown('00:20'), read('采集 2/5｜剩余约00:19'))).toBe('stage');
    expect(bossBarChange(read('落点 X=12:34'), read('落点 X=12:33'))).toBe('stage');
    expect(bossBarChange(read('Remaining: 02:00'), read('Remaining: 01:59'))).toBeNull();
    expect(bossBarChange(read('A 剩余01:00 B 剩余00:20'), read('A 剩余00:59 B 剩余00:19'))).toBe('stage');
  });
  it('keeps distinct native milestones and returns only unread events for a zero-history request', () => {
    const events = new EventCondenser();
    const base = { source: 'minecraft', type: 'minecraft.event', ts: '2026-01-01T00:00:00Z', origin: 'external' as const };
    for (const cursor of [1, 2, 3]) {
      events.push([{ ...base, cursor, text: '[Minecraft] Cave | 2:10 状态条进度为 50%。',
        meta: { bossBar: { id: String(cursor), reason: 'progress' } } }]);
    }
    expect(events.view().map(e => e.cursor)).toEqual([1, 2, 3]);
    expect(events.since(2, 0).map(e => e.cursor)).toEqual([3]);
    expect(events.since(3, 0)).toEqual([]);
  });
});

describe.each(['1.21.1', '1.20.6'])('current server HUD %s', version => {
  it('delays an empty add until a named observation and admits semantic changes at packet ingress', () => {
    const r = methodHarness(version);
    try {
      const emit = vi.spyOn(r.world as never as { emit(...args: unknown[]): unknown }, 'emit').mockImplementation(() => undefined);
      (r.world as never as { hookBotEvents(bot: unknown): void }).hookBotEvents(r.bot);
      const bar = { entityUUID: 'activity', title: { text: '' }, health: 1 };
      Object.assign(r.bot, { bossBars: { activity: bar } });
      r.bot.emit('bossBarCreated', bar);
      expect(emit).not.toHaveBeenCalled();
      for (const [title, health] of [['03:00', 1], ['02:50', .95], ['02:50', .75], ['02:40', .75], ['00:10', .75]] as const) {
        bar.title.text = '活动｜剩余约' + title; bar.health = health; r.bot.emit('bossBarUpdated', bar);
      }
      r.bot.emit('bossBarDeleted', bar);
      r.bot.emit('bossBarDeleted', bar);
      expect(emit.mock.calls.map(call => (call[3] as { meta: {bossBar: { reason: string }} }).meta.bossBar.reason))
        .toEqual(['appeared', 'progress', 'deadline', 'removed']);
    } finally { r.close(); }
  });
  it('keeps countdown ticks in current HUD facts without burying player or audience input in per-second events', () => {
    const r = methodHarness(version);
    try {
      const emit = vi.spyOn(r.world as never as { emit(...args: unknown[]): unknown }, 'emit').mockImplementation(() => undefined);
      (r.world as never as { hookBotEvents(bot: unknown): void }).hookBotEvents(r.bot);
      const bar = { entityUUID: 'activity', title: { text: '探索留影 | 2:14' }, health: 0.22 };
      Object.assign(r.bot, { bossBars: { activity: bar } });
      r.bot.emit('bossBarCreated', bar); emit.mockClear();
      for (let second = 13; second >= 1; second--) {
        bar.title = { text: `探索留影 | 2:${String(second).padStart(2, '0')}` };
        r.bot.emit('bossBarUpdated', bar);
      }
      expect(emit).not.toHaveBeenCalled();
      expect(r.world.requestFacts()!.parts?.find(p => p.key === 'hud')?.text).toContain('2:01');
      bar.health = 0.26; r.bot.emit('bossBarUpdated', bar);
      expect(emit).toHaveBeenCalledTimes(1);
      bar.title = { text: '探索留影 | 已完成 1/3' }; r.bot.emit('bossBarUpdated', bar);
      expect(emit).toHaveBeenCalledTimes(2);
      r.bot.emit('bossBarDeleted', bar);
      expect(emit).toHaveBeenCalledTimes(3);
    } finally { r.close(); }
  });
  it('reports a new stage title even when progress does not decrease, and keeps it in fresh request facts', () => {
    const r = methodHarness(version);
    try {
      const emit = vi.spyOn(r.world as never as { emit(...args: unknown[]): unknown }, 'emit').mockImplementation(() => undefined);
      (r.world as never as { hookBotEvents(bot: unknown): void }).hookBotEvents(r.bot);
      const bar = { entityUUID: 'quest', title: { text: '任务 · 调查 ｜前往标记 0/5' }, health: 0 };
      Object.assign(r.bot, { bossBars: { quest: bar } });
      r.bot.emit('bossBarCreated', bar); r.bot.emit('bossBarUpdated', bar); emit.mockClear();
      bar.title = { text: '任务 · 调查 ｜回到原遗迹继续 1/5' };
      r.bot.emit('bossBarUpdated', bar);
      expect(emit.mock.calls.some(call => String(call[1]).includes('回到原遗迹继续'))).toBe(true);
      const facts = r.world.requestFacts()!;
      expect(facts.parts?.find(p => p.key === 'hud')?.text).toContain('回到原遗迹继续');
      expect(facts.text).not.toContain('前往标记 0/5');
      expect(readBossBarHud({ quest: bar })[0].title).toContain('回到原遗迹继续');
      expect(structuredVisual(facts, 'text-only host', true).text).toContain('回到原遗迹继续');
      expect(structuredVisual(facts, 'text-only host', false).text).not.toContain('回到原遗迹继续');
      emit.mockClear(); r.bot.emit('bossBarUpdated', bar);
      expect(emit).not.toHaveBeenCalled();
      bar.health = 0.6; r.bot.emit('bossBarUpdated', bar);
      expect(emit.mock.calls.some(call => String(call[1]).includes('60%'))).toBe(true);
      Object.assign(r.bot, { bossBars: {} }); r.bot.emit('bossBarDeleted', bar);
      expect(r.world.requestFacts()!.parts?.find(p => p.key === 'hud')).toBeUndefined();
    } finally { r.close(); }
  });

  it('keeps transient skill experience quiet while retaining the boss damage threshold', () => {
    const r = methodHarness(version);
    try {
      const emit = vi.spyOn(r.world as never as { emit(...args: unknown[]): unknown }, 'emit').mockImplementation(() => undefined);
      (r.world as never as { hookBotEvents(bot: unknown): void }).hookBotEvents(r.bot);
      const xp = { entityUUID: 'xp', title: { text: '+12 挖掘 经验（25%）' }, health: 0.25 };
      Object.assign(r.bot, { bossBars: { xp } });
      r.bot.emit('bossBarCreated', xp); r.bot.emit('bossBarUpdated', xp);
      expect(emit).not.toHaveBeenCalled();
      expect(r.world.requestFacts()!.parts?.find(p => p.key === 'hud')).toBeUndefined();
      const boss = { entityUUID: 'boss', title: { text: 'Ender Dragon' }, health: 1 };
      r.bot.emit('bossBarCreated', boss); emit.mockClear();
      boss.health = 0.99; r.bot.emit('bossBarUpdated', boss); expect(emit).not.toHaveBeenCalled();
      boss.health = 0.74; r.bot.emit('bossBarUpdated', boss);
      expect(emit.mock.calls.some(call => String(call[1]).includes('74%'))).toBe(true);
    } finally { r.close(); }
  });
});
