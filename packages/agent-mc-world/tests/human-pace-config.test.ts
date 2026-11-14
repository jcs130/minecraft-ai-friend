import { describe, expect, it } from 'vitest';
import {
  HumanPaceConfigError,
  MINING_LIMIT_DEFAULTS,
  MiningLimiter,
  isMiningWarningText,
  miningLimitErrors,
  resolveMiningLimits,
  splitWarningKeywords,
} from '../core/mining-limiter.ts';
import { MINECRAFT_DEFAULTS, MINECRAFT_RHYTHM_CONFIG_GROUP } from '../core/config.ts';
import {
  MOVEMENT_PACE_DEFAULTS,
  movementPaceErrors,
  resolveMovementPace,
} from '../core/movement-pace.ts';

describe('miningLimits / movementPace config', () => {
  it('defaults on the World config match the limiter and pacer defaults', () => {
    expect(MINECRAFT_DEFAULTS.miningLimits).toEqual(MINING_LIMIT_DEFAULTS);
    expect(MINECRAFT_DEFAULTS.movementPace).toEqual(MOVEMENT_PACE_DEFAULTS);
    expect(resolveMiningLimits(undefined)).toEqual(MINING_LIMIT_DEFAULTS);
    expect(resolveMovementPace(null)).toEqual(MOVEMENT_PACE_DEFAULTS);
    expect(miningLimitErrors(MINING_LIMIT_DEFAULTS)).toEqual([]);
    expect(movementPaceErrors(MOVEMENT_PACE_DEFAULTS)).toEqual([]);
  });

  it('the rhythm schema exposes every limiter and pace field (hot-reloadable)', () => {
    const props = MINECRAFT_RHYTHM_CONFIG_GROUP.schema.properties as Record<string, unknown>;
    const miningKeys = Object.keys(MINING_LIMIT_DEFAULTS) as string[];
    const paceKeys = Object.keys(MOVEMENT_PACE_DEFAULTS) as string[];
    for (const key of miningKeys) {
      // The settings schema uses a CSV string; JSON configs still use warningKeywords: string[].
      if (key === 'warningKeywords') {
        expect(props['worlds.minecraft.miningLimits.warningKeywordsCsv'], key).toBeTruthy();
        continue;
      }
      expect(props[`worlds.minecraft.miningLimits.${key}`], key).toBeTruthy();
    }
    for (const key of paceKeys) {
      expect(props[`worlds.minecraft.movementPace.${key}`], key).toBeTruthy();
    }
  });

  it('merges partials, accepts a CSV or pipe-separated keyword string, and keeps unspecified defaults', () => {
    const a = resolveMiningLimits({ mineralPerMinute: 6, warningKeywords: '自定义警告,另一词' });
    expect(a.mineralPerMinute).toBe(6);
    expect(a.mineralPer10Min).toBe(MINING_LIMIT_DEFAULTS.mineralPer10Min);
    expect(a.warningKeywords).toEqual(['自定义警告', '另一词']);
    const b = resolveMiningLimits({ warningKeywordsCsv: '甲|乙，丙' } as Record<string, unknown>);
    expect(b.warningKeywords).toEqual(['甲', '乙', '丙']);
    expect(splitWarningKeywords('a, b | c')).toEqual(['a', 'b', 'c']);
    const p = resolveMovementPace({ maxLegBlocks: 32 });
    expect(p.maxLegBlocks).toBe(32);
    expect(p.maxYawDegPerTick).toBe(24);
  });

  it('rejects out-of-range numbers and broken regexes', () => {
    expect(() => resolveMiningLimits({ mineralPerMinute: 0 })).toThrow(HumanPaceConfigError);
    expect(() => resolveMiningLimits({ warningBudgetFactor: 1.5 })).toThrow(/warningBudgetFactor/);
    expect(() => resolveMiningLimits({ warningPattern: '(' })).toThrow(/warningPattern/);
    expect(() => resolveMovementPace({ maxYawDegPerTick: 0 })).toThrow(HumanPaceConfigError);
    expect(() => resolveMovementPace({ maxLegBlocks: -1 })).toThrow(/maxLegBlocks/);
    expect(() => resolveMovementPace({ maxPitchDegPerTick: 200 })).toThrow(/maxPitchDegPerTick/);
  });

  it('treats warning phrases as data: custom keywords match, defaults do not leak into an empty list', () => {
    const custom = resolveMiningLimits({
      warningKeywords: ['MY_SERVER_FLAG'],
      warningPattern: '',
      warningConfirmPattern: '',
      warningBanPattern: 'ban (\\d+) min',
      hardStopOnWarning: false,
    });
    expect(isMiningWarningText('[反作弊] 检测到你疑似在使用自动挖矿外挂', custom)).toBe(false);
    expect(isMiningWarningText('hello MY_SERVER_FLAG please stop', custom)).toBe(true);
    const c = { now: 1_000_000 };
    const l = new MiningLimiter(() => custom, () => c.now);
    expect(l.onChat('staff: MY_SERVER_FLAG ban 15 min on stone')).toBe(true);
    expect(l.check('stone').waitMs).toBe(15 * 60_000 + custom.warningBanMarginMs);
  });

  it('can disable either limiter through config', () => {
    const l = new MiningLimiter(() => resolveMiningLimits({ enabled: false }));
    l.record('stone');
    expect(l.check('stone').waitMs).toBe(0);
    const pace = resolveMovementPace({ enabled: false, maxLegBlocks: 1 });
    expect(pace.enabled).toBe(false);
  });
});
