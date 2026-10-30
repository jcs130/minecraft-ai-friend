import { describe, expect, it, vi } from 'vitest';
import { methodHarness } from './method-harness.ts';
import { structuredVisual } from '../src/client/visual.ts';
import { readBossBarHud } from '../src/client/index.ts';

describe.each(['1.21.1', '1.20.6'])('current server HUD %s', version => {
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
