import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { MiningLimiter, MINING_LIMIT_DEFAULTS, installMiningLimiter, isMineral, awaitMiningBudget } from '../core/mining-limiter.ts';
import { SkillBlocked } from '../core/skill-context.ts';

function clock(start = 1_000_000) { let t = start; return { now: () => t, add: (ms: number) => { t += ms; } }; }

describe('mining limiter (honest throttle)', () => {
  it('classifies stone, deepslate and ores as minerals but not logs, dirt or stone bricks', () => {
    for (const n of ['stone', 'deepslate', 'cobblestone', 'iron_ore', 'deepslate_diamond_ore', 'andesite', 'tuff', 'netherrack', 'ancient_debris']) expect(isMineral(n)).toBe(true);
    for (const n of ['oak_log', 'dirt', 'grass_block', 'sand', 'stone_bricks', 'smooth_stone', 'sandstone', 'stone_slab']) expect(isMineral(n)).toBe(false);
  });

  it('enforces the minimum gap and the per-minute mineral budget', () => {
    const c = clock();
    const l = new MiningLimiter(() => MINING_LIMIT_DEFAULTS, c.now);
    l.record('stone');
    expect(l.check('stone').waitMs).toBe(MINING_LIMIT_DEFAULTS.mineralGapMs);
    expect(l.check('oak_log').waitMs).toBe(MINING_LIMIT_DEFAULTS.anyGapMs);
    for (let i = 1; i < MINING_LIMIT_DEFAULTS.mineralPerMinute; i++) { c.add(3000); l.record('stone'); }
    c.add(3000);
    const v = l.check('stone');
    expect(v.reason).toContain('每分钟');
    expect(v.waitMs).toBeGreaterThan(20_000); // first of the 12 leaves the 60 s window
    expect(l.check('oak_log').waitMs).toBe(0); // logs still have budget
  });

  it('caps the rolling ten-minute total and asks for a rest after sustained mining', () => {
    const c = clock();
    const l = new MiningLimiter(() => ({ ...MINING_LIMIT_DEFAULTS, restAfterMs: 120_000 }), c.now);
    let rested = false;
    for (let i = 0; i < 200; i++) {
      const v = l.check('dirt');
      if (v.reason.includes('歇')) { rested = true; break; }
      c.add(Math.max(v.waitMs, 2600)); l.record('dirt');
    }
    expect(rested).toBe(true);
    const c2 = clock();
    const l2 = new MiningLimiter(() => ({ ...MINING_LIMIT_DEFAULTS, restAfterMs: 1e12 }), c2.now);
    for (let i = 0; i < MINING_LIMIT_DEFAULTS.mineralPer10Min; i++) { c2.add(5100); l2.record('stone'); }
    c2.add(5100);
    expect(l2.check('stone').reason).toContain('10 分钟');
  });

  it('backs off on a server warning (hard stop off): full pause, the stated mineral ban, then halved budgets', () => {
    const c = clock();
    const l = new MiningLimiter(() => ({ ...MINING_LIMIT_DEFAULTS, hardStopOnWarning: false }), c.now);
    expect(l.onChat('[MC] ZhiZhang: 被反作弊拦下的功能本座不管')).toBe(false); // advert, not addressed to us
    expect(l.onChat('[反作弊] 检测到你疑似在使用自动挖矿外挂,60 分钟内禁止挖石头和矿石')).toBe(true);
    expect(l.check('oak_log').waitMs).toBe(MINING_LIMIT_DEFAULTS.warningPauseMs);
    expect(l.check('stone').waitMs).toBe(60 * 60_000 + MINING_LIMIT_DEFAULTS.warningBanMarginMs);
    c.add(66 * 60_000);
    expect(l.check('stone').waitMs).toBe(0);
    for (let i = 0; i < MINING_LIMIT_DEFAULTS.mineralPerMinute / 2; i++) { l.record('stone'); c.add(2600); }
    expect(l.check('stone').reason).toContain(`${MINING_LIMIT_DEFAULTS.mineralPerMinute / 2} 块`);
  });

  it('wraps bot.dig: waits short gaps, blocks long waits with a planner-readable message, reacts to chat', async () => {
    const digs: string[] = [];
    const bot: any = Object.assign(new EventEmitter(), { dig: async (b: any) => { digs.push(b.name); } });
    installMiningLimiter(bot, () => ({ ...MINING_LIMIT_DEFAULTS, hardStopOnWarning: false, anyGapMs: 30, mineralGapMs: 30, inlineWaitMs: 200 }));
    await bot.dig({ name: 'stone' });
    const t0 = Date.now(); await bot.dig({ name: 'stone' });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(20);
    expect(digs).toEqual(['stone', 'stone']);
    bot.emit('messagestr', '[反作弊] 检测到你疑似在使用作弊客户端(VL 257),继续使用将被处罚!');
    const err = await awaitMiningBudget(bot, 'oak_log', () => false).catch((e) => e);
    expect(err).toBeInstanceOf(SkillBlocked);
    expect(err.message).toMatch(/mining budget exhausted, wait \d+s/);
    expect(digs).toHaveLength(2);
  });
});

describe('mining limiter scope', () => {
  it('does not count zero-hardness blocks (grass, flowers) the pathfinder walks through', async () => {
    const bot: any = Object.assign(new EventEmitter(), { dig: async () => {} });
    const l = installMiningLimiter(bot, () => MINING_LIMIT_DEFAULTS);
    for (let i = 0; i < 5; i++) await bot.dig({ name: 'short_grass', hardness: 0 });
    expect(l.status().minuteAll).toBe(0);
  });
});
