/**
 * Human-pace limits for automatic movement (pathfinder and look/turn). Honest pace caps only:
 * deterministic limits on how fast and how long the bot walks and turns, no random noise, no
 * spoofing. Some servers flag Baritone-style auto-pathing. When hardStopOnWarning is on, a
 * chat warning matched by worlds.minecraft.miningLimits.warningKeywords (or warningPattern)
 * stops pathfinding for the rest of the session. All caps are worlds.minecraft.movementPace;
 * see docs/human-pace-limits.md. Server-specific phrases belong in that config, not here.
 *
 * Defaults (real-player reference):
 * - turning: a player turning with the mouse during normal walking moves ~200–600°/s; flicks are
 *   rarer. Cap 24°/tick (480°/s) for yaw, 16°/tick for pitch; a 180° turn takes ~8 ticks (0.4 s)
 *   instead of a 1-tick snap.
 * - continuous auto-walk: people stop to look around, check the map or chat. Pathfind at most
 *   75 s in a row, then stand still 6 s.
 * - stops between legs: after reaching one goal, wait 1 s before walking the next leg.
 * - leg length: one goto may cover at most 96 blocks (straight-line) — farther targets must be split
 *   into legs by the planner, each with its own stop.
 * Walking/sprinting speed itself is vanilla physics (no speed hacks), so no extra cap is needed.
 */
import { SkillBlocked } from './skill-context.ts';
import { HumanPaceConfigError } from './mining-limiter.ts';

export interface MovementPace {
  enabled: boolean;
  maxYawDegPerTick: number;
  maxPitchDegPerTick: number;
  moveBeforeRestMs: number;
  restMs: number;
  legGapMs: number;
  maxLegBlocks: number;
  hardStopOnWarning: boolean;
}

export const MOVEMENT_PACE_DEFAULTS: MovementPace = {
  enabled: true,
  maxYawDegPerTick: 24,
  maxPitchDegPerTick: 16,
  moveBeforeRestMs: 75_000,
  restMs: 6_000,
  legGapMs: 1_000,
  maxLegBlocks: 96,
  hardStopOnWarning: true,
};

const PACE_POSITIVE: Array<[keyof MovementPace, number]> = [
  ['maxYawDegPerTick', 1], ['maxPitchDegPerTick', 1], ['maxLegBlocks', 1],
];
const PACE_MS: Array<[keyof MovementPace, number]> = [
  ['moveBeforeRestMs', 0], ['restMs', 0], ['legGapMs', 0],
];

export function movementPaceErrors(pace: MovementPace): string[] {
  const errors: string[] = [];
  if (typeof pace.enabled !== 'boolean') errors.push('movementPace.enabled must be a boolean');
  if (typeof pace.hardStopOnWarning !== 'boolean') errors.push('movementPace.hardStopOnWarning must be a boolean');
  for (const [key, min] of PACE_POSITIVE) {
    const n = pace[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min) {
      errors.push(`movementPace.${key} must be a number >= ${min}`);
    }
  }
  if (typeof pace.maxYawDegPerTick === 'number' && pace.maxYawDegPerTick > 180) {
    errors.push('movementPace.maxYawDegPerTick must be <= 180');
  }
  if (typeof pace.maxPitchDegPerTick === 'number' && pace.maxPitchDegPerTick > 180) {
    errors.push('movementPace.maxPitchDegPerTick must be <= 180');
  }
  for (const [key, min] of PACE_MS) {
    const n = pace[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min) {
      errors.push(`movementPace.${key} must be a number >= ${min}`);
    }
  }
  return errors;
}

/** Merge a partial `worlds.minecraft.movementPace` object with defaults and validate. Throws HumanPaceConfigError. */
export function resolveMovementPace(partial?: Partial<MovementPace> | Record<string, unknown> | null): MovementPace {
  const src = partial && typeof partial === 'object' ? partial as Record<string, unknown> : {};
  const out: MovementPace = { ...MOVEMENT_PACE_DEFAULTS };
  for (const key of Object.keys(MOVEMENT_PACE_DEFAULTS) as (keyof MovementPace)[]) {
    if (src[key] === undefined) continue;
    if (key === 'enabled' || key === 'hardStopOnWarning') out[key] = Boolean(src[key]);
    else out[key] = Number(src[key]) as never;
  }
  const errors = movementPaceErrors(out);
  if (errors.length) throw new HumanPaceConfigError(errors);
  return out;
}

const DEG = Math.PI / 180;
const wrap = (a: number) => { let d = a % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };

/** One rotation step toward the target, capped per tick. Exported for tests. */
export function stepRotation(fromYaw: number, fromPitch: number, toYaw: number, toPitch: number, p: Pick<MovementPace, 'maxYawDegPerTick' | 'maxPitchDegPerTick'>): [number, number, boolean] {
  const dy = wrap(toYaw - fromYaw); const dp = toPitch - fromPitch;
  const my = p.maxYawDegPerTick * DEG; const mp = p.maxPitchDegPerTick * DEG;
  const sy = Math.max(-my, Math.min(my, dy)); const sp = Math.max(-mp, Math.min(mp, dp));
  const done = Math.abs(dy) <= my && Math.abs(dp) <= mp;
  return [done ? fromYaw + dy : fromYaw + sy, done ? toPitch : fromPitch + sp, done];
}

/** Pathfinding streak/rest/leg-gap bookkeeping; time is injectable for tests. */
export class MovementPacer {
  private streakStart = 0;
  private lastMoving = 0;
  private restUntil = 0;
  hardStopped = false;
  constructor(private cfg: () => MovementPace, private now: () => number = Date.now) {}
  /** Called each physics tick with whether the pathfinder is driving the body. */
  tick(moving: boolean): void {
    const c = this.cfg(); const t = this.now();
    if (!c.enabled) return;
    if (!moving || t < this.restUntil) { if (!moving && t - this.lastMoving > c.restMs) this.streakStart = 0; return; }
    if (!this.streakStart) this.streakStart = t;
    this.lastMoving = t;
    if (t - this.streakStart >= c.moveBeforeRestMs) { this.restUntil = t + c.restMs; this.streakStart = 0; }
  }
  goalReached(): void { const c = this.cfg(); if (c.enabled) this.restUntil = Math.max(this.restUntil, this.now() + c.legGapMs); }
  /** True while the pathfinder must hold still (rest, leg gap, or hard stop). */
  paused(): boolean { return this.hardStopped || (this.cfg().enabled && this.now() < this.restUntil); }
  restingMs(): number { return this.hardStopped ? Infinity : Math.max(0, this.restUntil - this.now()); }
  warn(): void { if (this.cfg().hardStopOnWarning) this.hardStopped = true; }
}

export const pathfindingStoppedMessage = '寻路已停：服务器发过反作弊/自动化模组警告，再自动寻路或挖矿会被临时封禁，本次会话不再自动走路（pathfinding stopped for this session after a server warning）。原地待着，只做聊天、看状态之类不移动的事。';

type AnyBot = any;

/**
 * Install on a bot: rate-limited `bot.look` (no instant snaps), pathfinder rest/leg-gap pauses
 * (read by the patched pathfinder monitorMovement through `bot._pacePause`), and a hard stop on
 * the `miningWarning` event the mining limiter emits for any anti-cheat warning.
 */
export function installMovementPace(bot: AnyBot, pace: () => MovementPace): MovementPacer {
  if (bot._movementPacer) return bot._movementPacer;
  const resolved = (): MovementPace => {
    try { return resolveMovementPace(pace()); }
    catch { return resolveMovementPace(null); }
  };
  const pacer = new MovementPacer(resolved);
  bot._movementPacer = pacer;
  bot._pacePause = () => pacer.paused();
  bot.on('physicsTick', () => pacer.tick(Boolean(bot.pathfinder?.isMoving?.())));
  bot.on('goal_reached', () => pacer.goalReached());
  bot.on('miningWarning', () => {
    pacer.warn();
    if (pacer.hardStopped) { try { bot.pathfinder?.setGoal?.(null); } catch {} try { bot.clearControlStates?.(); } catch {} }
  });
  const wrapLook = () => {
    const orig = bot.look;
    if (!orig || orig.__paced) return;
    let token = 0;
    const paced = async function (this: unknown, yaw: number, pitch: number, force?: boolean) {
      const c = resolved();
      if (!c.enabled || !bot.entity) return orig.call(bot, yaw, pitch, force);
      const my = ++token;
      for (let i = 0; i < 200; i++) {
        const [y, p, done] = stepRotation(bot.entity.yaw, bot.entity.pitch, yaw, pitch, c);
        if (done) return orig.call(bot, y, p, force);
        await orig.call(bot, y, p, true);
        await new Promise<void>((r) => bot.once('physicsTick', () => r()));
        if (my !== token) return; // superseded by a newer look (pathfinder re-aims every tick)
      }
    };
    (paced as any).__paced = true;
    bot.look = paced;
  };
  wrapLook();
  bot.on('login', wrapLook); bot.on('spawn', wrapLook);
  return pacer;
}

/** Skill-level gate before a goto: hard stop and leg length. */
export function assertMovementAllowed(bot: AnyBot, target?: { x: number; y: number; z: number } | null): void {
  const pacer: MovementPacer | undefined = bot._movementPacer;
  if (!pacer) return;
  if (pacer.hardStopped || bot._miningLimiter?.hardStopped) throw new SkillBlocked(pathfindingStoppedMessage, [], 'local', 'resource-unavailable');
  const c = (pacer as any).cfg() as MovementPace;
  const pos = bot.entity?.position;
  if (c.enabled && target && pos && Number.isFinite(target.x)) {
    const d = Math.hypot(target.x - pos.x, target.z - pos.z);
    if (d > c.maxLegBlocks) {
      throw new SkillBlocked(`寻路限速：一段最多走 ${c.maxLegBlocks} 格，这里直线 ${Math.round(d)} 格（route leg too long: split into legs of ≤${c.maxLegBlocks} blocks）。先走到途中某点，停一下再走下一段。`, [], 'local', 'resource-unavailable');
    }
  }
}
