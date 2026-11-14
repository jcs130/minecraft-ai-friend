import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { MovementPacer, MOVEMENT_PACE_DEFAULTS, stepRotation, installMovementPace, assertMovementAllowed } from '../core/movement-pace.ts';
import { installMiningLimiter, MINING_LIMIT_DEFAULTS, MiningLimiter, miningBlockedMessage } from '../core/mining-limiter.ts';
import { SkillBlocked } from '../core/skill-context.ts';
import fs from 'node:fs';

describe('movement pace (human-level, deterministic)', () => {
  it('turns at most 24°/tick: a 180° turn takes several ticks, never a snap', () => {
    let yaw = 0, pitch = 0, ticks = 0, done = false;
    while (!done) { [yaw, pitch, done] = stepRotation(yaw, pitch, Math.PI, 0.5, MOVEMENT_PACE_DEFAULTS); ticks++; }
    expect(ticks).toBe(8);
    expect(yaw).toBeCloseTo(Math.PI);
    const [y1] = stepRotation(0, 0, Math.PI / 2, 0, MOVEMENT_PACE_DEFAULTS);
    expect(y1).toBeCloseTo(24 * Math.PI / 180);
    // takes the short way round
    const [y2] = stepRotation(3, 0, -3, 0, MOVEMENT_PACE_DEFAULTS);
    expect(y2).toBeGreaterThan(3);
  });

  it('rests after a long continuous walk and pauses between legs', () => {
    let t = 0; const p = new MovementPacer(() => MOVEMENT_PACE_DEFAULTS, () => t);
    for (; t < 74_000; t += 50) p.tick(true);
    expect(p.paused()).toBe(false);
    for (; t < 76_000; t += 50) p.tick(true);
    expect(p.paused()).toBe(true);
    t += MOVEMENT_PACE_DEFAULTS.restMs + 10; expect(p.paused()).toBe(false);
    p.goalReached(); expect(p.paused()).toBe(true); expect(p.restingMs()).toBe(1000);
  });

  it('hard-stops pathfinding and digging for the session on an automation-mod warning', async () => {
    const bot: any = Object.assign(new EventEmitter() as any, { dig: async () => {}, look: async () => {}, entity: { yaw: 0, pitch: 0, position: { x: 0, y: 64, z: 0 } },
      cleared: false, clearControlStates(this: any) { this.cleared = true; }, pathfinder: { goal: 1 as unknown, setGoal(this: any, g: unknown) { this.goal = g; }, isMoving: () => false } });
    const lim = installMiningLimiter(bot, () => MINING_LIMIT_DEFAULTS);
    const pacer = installMovementPace(bot, () => MOVEMENT_PACE_DEFAULTS);
    assertMovementAllowed(bot, { x: 50, y: 64, z: 0 });
    expect(() => assertMovementAllowed(bot, { x: 200, y: 64, z: 0 })).toThrow(/route leg too long/);
    bot.emit('messagestr', '[反作弊] 检测到你疑似在使用自动化模组，继续使用将被临时封禁');
    expect(pacer.hardStopped).toBe(true); expect(lim.hardStopped).toBe(true);
    expect(bot.pathfinder.goal).toBeNull(); expect(bot.cleared).toBe(true);
    expect(bot._pacePause()).toBe(true);
    expect(() => assertMovementAllowed(bot, { x: 1, y: 64, z: 0 })).toThrow(SkillBlocked);
    const err = await bot.dig({ name: 'oak_log', hardness: 2 }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(SkillBlocked); expect(err.message).toMatch(/mining stopped for this session/);
  });

  it('ignores unrelated chat and keeps a finite message when hard stop is off', () => {
    const l = new MiningLimiter(() => ({ ...MINING_LIMIT_DEFAULTS, hardStopOnWarning: false }), () => 0);
    expect(l.onChat('欢迎来到永恒世界，外挂举报请找管理')).toBe(false);
    expect(l.onChat('[反作弊] 检测到你疑似在使用自动化模组')).toBe(true);
    expect(miningBlockedMessage('stone', l.check('stone'))).toMatch(/wait \d+s/);
  });

  it('pathfinder patch holds still while paced without dropping the goal', () => {
    const src = fs.readFileSync(new URL('../core/dependency-patches.ts', import.meta.url), 'utf8');
    expect(src).toContain("typeof bot._pacePause === 'function' && bot._pacePause()");
  });
});
