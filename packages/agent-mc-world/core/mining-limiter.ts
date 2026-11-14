/**
 * Mining rate limiter: an honest throttle that keeps the bot at a normal player's mining pace.
 *
 * Servers run anti-autominer plugins (VeinGuard, AntiXray-style rate windows, custom "自动挖矿"
 * checks) that count block breaks per sliding window. A bot that digs back-to-back for minutes is
 * exactly what they are meant to stop, so this only slows the bot down: rolling budgets per minute
 * and per ten minutes, a minimum gap between digs, rest breaks after sustained mining, and a strong
 * back-off when the server warns. No input noise, no spoofing — waits are real and are reported
 * to the planner ("mining budget exhausted, wait Ns") so it can do something else meanwhile.
 *
 * All thresholds are `worlds.minecraft.miningLimits` (see docs/human-pace-limits.md). Warning
 * phrases are data: set warningKeywords / warningPattern / warningBanPattern per server; do not
 * hardcode a new server's chat into this file.
 */
import { SkillBlocked } from './skill-context.ts';

export interface MiningLimits {
  enabled: boolean;
  /** Stone, deepslate, ores and other underground blocks ("minerals"). */
  mineralPerMinute: number;
  mineralPer10Min: number;
  /** Every block broken (logs, dirt, sand, plants with a dig time ...). */
  allPerMinute: number;
  allPer10Min: number;
  /** Minimum gap between two dig starts, minerals / anything else. */
  mineralGapMs: number;
  anyGapMs: number;
  /** After this much continuous mining (no pause ≥ restMs), rest for restMs. */
  restAfterMs: number;
  restMs: number;
  /** Waits up to this long are waited out in place; longer ones are reported as blocked. */
  inlineWaitMs: number;
  /** On an anti-cheat / auto-mining warning: no digging at all for this long ... */
  warningPauseMs: number;
  /** Server says continuing after a warning means a temp ban: stop all digging for the rest of the session. */
  hardStopOnWarning: boolean;
  /** ... (or the server's own stated ban + margin for minerals, whichever is longer) ... */
  warningBanMarginMs: number;
  /** ... then budgets scaled by this factor for warningReducedMs. */
  warningBudgetFactor: number;
  warningReducedMs: number;
  /**
   * Chat substrings that mark a warning to this player. Server-specific phrases
   * belong here (or in warningPattern), not as new hardcoded core checks.
   */
  warningKeywords: string[];
  /**
   * Optional extra regex; a line matches when it hits a keyword *or* this pattern.
   * Empty = keywords only.
   */
  warningPattern: string;
  /**
   * A keyword/pattern hit must also match this regex so advertisements that only
   * quote the words are ignored. Empty = no extra filter. Case-insensitive.
   */
  warningConfirmPattern: string;
  /**
   * Regex whose first capture group is a number of minutes in a server dig-ban
   * line (e.g. "60 分钟内禁止挖"). Empty = do not parse a timed mineral ban.
   */
  warningBanPattern: string;
}

/**
 * Defaults sit well under a legit survival pace: an iron pickaxe needs 8 ticks per stone plus the
 * 5-tick destroy delay (~90 blocks/min flat out); players strip-mining with walking, torches and
 * inventory stops average a few tens per minute. Plugins count tracked breaks per window (e.g. 15
 * ores / 5 min), so a ten-minute cap matters as much as the per-minute one.
 */
export const MINING_LIMIT_DEFAULTS: MiningLimits = {
  enabled: true,
  mineralPerMinute: 12,
  mineralPer10Min: 80,
  allPerMinute: 24,
  allPer10Min: 160,
  mineralGapMs: 2500,
  anyGapMs: 1000,
  restAfterMs: 4 * 60_000,
  restMs: 60_000,
  inlineWaitMs: 8_000,
  warningPauseMs: 20 * 60_000,
  hardStopOnWarning: true,
  warningBanMarginMs: 5 * 60_000,
  warningBudgetFactor: 0.5,
  warningReducedMs: 60 * 60_000,
  warningKeywords: ['反作弊', '自动挖矿', '挖矿外挂', '禁止挖', '自动化模组', '外挂'],
  // Same terms as warningKeywords, kept so older configs that only set warningPattern still work.
  warningPattern: '反作弊|自动挖矿|挖矿外挂|禁止挖|自动化模组|外挂',
  warningConfirmPattern: '你|检测|禁止|VL',
  warningBanPattern: '(\\d+)\\s*分钟内禁止挖',
};


export class HumanPaceConfigError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join('; '));
    this.name = 'HumanPaceConfigError';
  }
}

/** Split a keyword list from JSON arrays or a comma/pipe-separated string (settings UI). */
export function splitWarningKeywords(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((s) => String(s).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[,|，]/).map((s) => s.trim()).filter(Boolean);
  return [];
}

function compileRe(pattern: string, flags?: string): RegExp | null {
  if (!pattern) return null;
  try { return new RegExp(pattern, flags); } catch { return null; }
}

/** True when this chat line should be treated as a mining/automation warning under `limits`. */
export function isMiningWarningText(text: string, limits: MiningLimits): boolean {
  if (!text) return false;
  const hitKeyword = (limits.warningKeywords ?? []).some((k) => k && text.includes(k));
  const hitPattern = compileRe(limits.warningPattern)?.test(text) ?? false;
  if (!hitKeyword && !hitPattern) return false;
  const confirm = limits.warningConfirmPattern;
  if (confirm && !(compileRe(confirm, 'i')?.test(text))) return false;
  return true;
}

const MINING_INT_MIN: Array<[keyof MiningLimits, number]> = [
  ['mineralPerMinute', 1], ['mineralPer10Min', 1], ['allPerMinute', 1], ['allPer10Min', 1],
];
const MINING_MS_MIN: Array<[keyof MiningLimits, number]> = [
  ['mineralGapMs', 0], ['anyGapMs', 0], ['restAfterMs', 0], ['restMs', 0], ['inlineWaitMs', 0],
  ['warningPauseMs', 0], ['warningBanMarginMs', 0], ['warningReducedMs', 0],
];

export function miningLimitErrors(limits: MiningLimits): string[] {
  const errors: string[] = [];
  if (typeof limits.enabled !== 'boolean') errors.push('miningLimits.enabled must be a boolean');
  if (typeof limits.hardStopOnWarning !== 'boolean') errors.push('miningLimits.hardStopOnWarning must be a boolean');
  for (const [key, min] of MINING_INT_MIN) {
    const n = limits[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n) || n < min) {
      errors.push(`miningLimits.${key} must be an integer >= ${min}`);
    }
  }
  for (const [key, min] of MINING_MS_MIN) {
    const n = limits[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min) {
      errors.push(`miningLimits.${key} must be a number >= ${min}`);
    }
  }
  const f = limits.warningBudgetFactor;
  if (typeof f !== 'number' || !Number.isFinite(f) || f < 0 || f > 1) {
    errors.push('miningLimits.warningBudgetFactor must be a number between 0 and 1');
  }
  if (!Array.isArray(limits.warningKeywords) || limits.warningKeywords.some((k) => typeof k !== 'string')) {
    errors.push('miningLimits.warningKeywords must be an array of strings');
  }
  for (const [key, flags] of [['warningPattern', ''], ['warningConfirmPattern', 'i'], ['warningBanPattern', '']] as const) {
    const v = limits[key];
    if (typeof v !== 'string') errors.push(`miningLimits.${key} must be a string`);
    else if (v && !compileRe(v, flags)) errors.push(`miningLimits.${key} is not a valid regular expression`);
  }
  return errors;
}

/** Merge a partial `worlds.minecraft.miningLimits` object with defaults and validate. Throws HumanPaceConfigError. */
export function resolveMiningLimits(partial?: Partial<MiningLimits> | Record<string, unknown> | null): MiningLimits {
  const src = partial && typeof partial === 'object' ? partial as Record<string, unknown> : {};
  const out: MiningLimits = {
    ...MINING_LIMIT_DEFAULTS,
    warningKeywords: [...MINING_LIMIT_DEFAULTS.warningKeywords],
  };
  for (const key of Object.keys(MINING_LIMIT_DEFAULTS) as (keyof MiningLimits)[]) {
    if (src[key] === undefined) continue;
    if (key === 'warningKeywords') out.warningKeywords = splitWarningKeywords(src.warningKeywords);
    else if (key === 'enabled' || key === 'hardStopOnWarning') out[key] = Boolean(src[key]);
    else if (typeof MINING_LIMIT_DEFAULTS[key] === 'number') out[key] = Number(src[key]) as never;
    else if (typeof MINING_LIMIT_DEFAULTS[key] === 'string') out[key] = String(src[key] ?? '') as never;
  }
  if (src.warningKeywords === undefined && src.warningKeywordsCsv !== undefined) {
    out.warningKeywords = splitWarningKeywords(src.warningKeywordsCsv);
  }
  const errors = miningLimitErrors(out);
  if (errors.length) throw new HumanPaceConfigError(errors);
  return out;
}

const MINERAL = /(^|_)(stone|deepslate|cobblestone|cobbled_deepslate|andesite|diorite|granite|tuff|calcite|dripstone_block|netherrack|basalt|blackstone|end_stone|obsidian|ancient_debris|amethyst_block|budding_amethyst|raw_\w+_block)$|_ore$/;

export function isMineral(name: string): boolean {
  if (!name) return false;
  if (/(_slab|_stairs|_wall|_button|_pressure_plate|_bricks?|polished_|smooth_|chiseled_|cut_)/.test(name) && !name.endsWith('_ore')) return false;
  return MINERAL.test(name);
}

export interface MiningVerdict { waitMs: number; reason: string; scope: 'mineral' | 'all' | null }

export class MiningLimiter {
  private starts: Array<{ at: number; mineral: boolean }> = [];
  private pauseUntil = 0;
  /** Set by a server warning when hardStopOnWarning: nothing digs or pathfinds until the process restarts. */
  hardStopped = false;
  private mineralBanUntil = 0;
  private reducedUntil = 0;
  private streakStart = 0;
  private lastStart = 0;
  private lastMineralStart = 0;
  lastWarning: { at: number; text: string } | null = null;

  constructor(private limits: () => MiningLimits = () => MINING_LIMIT_DEFAULTS, private now: () => number = Date.now) {}

  config(): MiningLimits {
    try { return resolveMiningLimits(this.limits()); }
    catch { return resolveMiningLimits(null); }
  }
  private cfg(): MiningLimits { return this.config(); }

  /** How long the next dig of this block must wait (0 = now), and why. */
  check(blockName: string): MiningVerdict {
    const c = this.cfg();
    if (!c.enabled) return { waitMs: 0, reason: '', scope: null };
    const t = this.now();
    const mineral = isMineral(blockName);
    const waits: MiningVerdict[] = [];
    if (t < this.pauseUntil) waits.push({ waitMs: this.pauseUntil - t, reason: '服务器发过反作弊/自动挖矿警告，暂停挖掘', scope: 'all' });
    if (mineral && t < this.mineralBanUntil) waits.push({ waitMs: this.mineralBanUntil - t, reason: '服务器禁止挖石头和矿石的时段还没过', scope: 'mineral' });
    const f = t < this.reducedUntil ? c.warningBudgetFactor : 1;
    const window = (ms: number, onlyMineral: boolean, cap: number, label: string, scope: 'mineral' | 'all') => {
      const max = Math.max(1, Math.floor(cap * f));
      const inWin = this.starts.filter((s) => s.at > t - ms && (!onlyMineral || s.mineral));
      if (inWin.length >= max) waits.push({ waitMs: inWin[inWin.length - max].at + ms - t, reason: `${label}额度 ${max} 块已用完`, scope });
    };
    if (mineral) {
      window(60_000, true, c.mineralPerMinute, '石头/矿石每分钟', 'mineral');
      window(600_000, true, c.mineralPer10Min, '石头/矿石每 10 分钟', 'mineral');
      if (this.lastMineralStart && t - this.lastMineralStart < c.mineralGapMs) waits.push({ waitMs: this.lastMineralStart + c.mineralGapMs - t, reason: '两次挖石头/矿石之间的最短间隔', scope: 'mineral' });
    }
    window(60_000, false, c.allPerMinute, '每分钟挖方块', 'all');
    window(600_000, false, c.allPer10Min, '每 10 分钟挖方块', 'all');
    if (this.lastStart && t - this.lastStart < c.anyGapMs) waits.push({ waitMs: this.lastStart + c.anyGapMs - t, reason: '两次挖掘之间的最短间隔', scope: 'all' });
    if (this.streakStart && t - this.lastStart < c.restMs && t - this.streakStart >= c.restAfterMs) {
      waits.push({ waitMs: this.lastStart + c.restMs - t, reason: `连续挖了 ${Math.round((t - this.streakStart) / 60_000)} 分钟，歇一会儿`, scope: 'all' });
    }
    if (!waits.length) return { waitMs: 0, reason: '', scope: null };
    return waits.reduce((a, b) => (b.waitMs > a.waitMs ? b : a));
  }

  /** Record a dig start (call right before the dig packet goes out). */
  record(blockName: string): void {
    const t = this.now();
    const c = this.cfg();
    const mineral = isMineral(blockName);
    if (!this.streakStart || t - this.lastStart >= c.restMs) this.streakStart = t;
    this.lastStart = t;
    if (mineral) this.lastMineralStart = t;
    this.starts.push({ at: t, mineral });
    while (this.starts.length && this.starts[0].at <= t - 600_000) this.starts.shift();
  }

  /** Feed a chat line; returns true when it is an anti-cheat / auto-mining warning. */
  onChat(text: string): boolean {
    const c = this.cfg();
    if (!isMiningWarningText(text, c)) return false;
    const t = this.now();
    this.lastWarning = { at: t, text: text.slice(0, 200) };
    this.pauseUntil = c.hardStopOnWarning ? Infinity : Math.max(this.pauseUntil, t + c.warningPauseMs);
    const ban = compileRe(c.warningBanPattern);
    const m = ban?.exec(text);
    if (m?.[1] && Number.isFinite(Number(m[1]))) {
      this.mineralBanUntil = Math.max(this.mineralBanUntil, t + Number(m[1]) * 60_000 + c.warningBanMarginMs);
    }
    this.reducedUntil = Math.max(this.reducedUntil, this.pauseUntil, this.mineralBanUntil) + c.warningReducedMs;
    this.hardStopped = this.hardStopped || c.hardStopOnWarning;
    return true;
  }

  status(): { minuteMineral: number; minuteAll: number; tenMinMineral: number; tenMinAll: number; pausedMs: number; mineralBanMs: number; reduced: boolean } {
    const t = this.now();
    const n = (ms: number, mineral: boolean) => this.starts.filter((s) => s.at > t - ms && (!mineral || s.mineral)).length;
    return { minuteMineral: n(60_000, true), minuteAll: n(60_000, false), tenMinMineral: n(600_000, true), tenMinAll: n(600_000, false),
      pausedMs: Math.max(0, this.pauseUntil - t), mineralBanMs: Math.max(0, this.mineralBanUntil - t), reduced: t < this.reducedUntil };
  }
}

export function miningBlockedMessage(blockName: string, v: MiningVerdict): string {
  if (!Number.isFinite(v.waitMs)) {
    return `挖矿已停：服务器发过反作弊/自动化模组警告，再挖会被临时封禁，本次会话不再挖${blockName}（mining stopped for this session after a server warning）。只做不挖方块、不自动寻路的事，或者原地待着。`;
  }
  const s = Math.ceil(v.waitMs / 1000);
  const tail = v.scope === 'mineral' ? '这段时间可以去砍树、捡东西、整理背包、赶路或做别的，不挖石头和矿石。' : '这段时间先做不挖方块的事（赶路、整理、合成、看任务），别连着挖。';
  return `挖矿限速：${v.reason}，还要等 ${s} 秒才能挖${blockName}（mining budget exhausted, wait ${s}s）。${tail}`;
}

type AnyBot = { dig?: (...a: any[]) => Promise<void>; on: (e: string, f: (...a: any[]) => void) => void; once?: (e: string, f: (...a: any[]) => void) => void; _miningLimiter?: MiningLimiter; emit?: (e: string, ...a: any[]) => void };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Attach the limiter to a bot: wraps `bot.dig` (every caller, including pathfinder and scripts)
 * and watches chat for warnings. Idempotent; re-wraps after plugins replace `bot.dig`.
 */
export function installMiningLimiter(bot: AnyBot, limits: () => MiningLimits | undefined, diag?: (event: string, data: Record<string, unknown>) => void): MiningLimiter {
  if (!bot._miningLimiter) {
    const limiter = new MiningLimiter(() => ({ ...MINING_LIMIT_DEFAULTS, ...(limits() ?? {}) }));
    bot._miningLimiter = limiter;
    bot.on('messagestr', (text: string) => {
      if (limiter.onChat(String(text))) {
        diag?.('mining-warning', { text: String(text).slice(0, 200), status: limiter.status() });
        bot.emit?.('miningWarning', String(text));
      }
    });
  }
  const limiter = bot._miningLimiter;
  const wrap = () => {
    const current = bot.dig as any;
    if (typeof current !== 'function' || current.__miningLimited) return;
    const wrapped = async function (this: unknown, block: any, ...rest: any[]) {
      const name = String(block?.name ?? '');
      // Plants, torches and other zero-hardness blocks are not mining (pathfinder walks through grass).
      if (block?.hardness === 0) return current.call(bot, block, ...rest);
      let v = limiter.check(name);
      if (v.waitMs > 0) {
        if (v.waitMs > limiter.config().inlineWaitMs) {
          // Pathfinder retries a failed dig on its next tick: hold briefly so a long wait is not a busy loop.
          await sleep(Math.min(2000, v.waitMs));
          throw new SkillBlocked(miningBlockedMessage(name, v), [], 'local', 'resource-unavailable');
        }
        for (let i = 0; i < 4 && v.waitMs > 0 && v.waitMs <= limiter.config().inlineWaitMs; i++) {
          await sleep(v.waitMs + 5);
          v = limiter.check(name);
        }
        if (v.waitMs > 0) throw new SkillBlocked(miningBlockedMessage(name, v), [], 'local', 'resource-unavailable');
      }
      limiter.record(name);
      return current.call(bot, block, ...rest);
    };
    (wrapped as any).__miningLimited = true;
    bot.dig = wrapped as any;
  };
  wrap();
  bot.on('login', wrap);
  bot.on('spawn', wrap);
  return limiter;
}

/**
 * Skill-side wait before a dig: waits short gaps in place (abortable), reports long ones as a
 * blocked step so the planner switches activity instead of spinning.
 */
export async function awaitMiningBudget(bot: AnyBot, blockName: string, aborted: () => boolean, hardness?: number | null): Promise<void> {
  const limiter = bot._miningLimiter;
  if (!limiter || hardness === 0) return;
  const v = limiter.check(blockName);
  if (v.waitMs <= 0) return;
  const inline = limiter.config().inlineWaitMs;
  if (v.waitMs > inline) throw new SkillBlocked(miningBlockedMessage(blockName, v), [], 'local', 'resource-unavailable');
  const until = Date.now() + v.waitMs;
  while (Date.now() < until) {
    if (aborted()) return;
    await sleep(Math.min(250, until - Date.now()));
  }
}
