/** Short input sequences share the executor's body ownership and report observed movement. */
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { flightState, flyWithInput } from './flight.ts';
import { SkillBlocked, checkAbort, sleep, type SkillContext } from './skill-context.ts';
import type { ControlKey, SkillCall } from './skills.ts';
import { bodyInWater, headInWater } from './terrain.ts';

interface InputLease {
  keys: ControlKey[];
  mode: Extract<SkillCall, { skill: 'control' }>['mode'];
  finish: () => void;
  reason?: string;
  source?: 'server' | 'local';
}
const inputs = new WeakMap<Bot, InputLease>();
const nativeInputs = new WeakMap<Bot, Set<symbol>>();

/** A native program owns its key state until completion or revocation. */
export function ownNativeControlInput(bot: Bot): () => void {
  const owners = nativeInputs.get(bot) ?? new Set<symbol>();
  const owner = Symbol('native control');
  owners.add(owner); nativeInputs.set(bot, owners);
  return () => {
    owners.delete(owner);
    if (!owners.size && nativeInputs.get(bot) === owners) nativeInputs.delete(bot);
  };
}

/** Passive treading must not rewrite an explicit water skill or native key program. */
export function waterControlActive(bot: Bot): boolean {
  return inputs.get(bot)?.mode === 'water' || (nativeInputs.get(bot)?.size ?? 0) > 0;
}

function waterReadout(bot: Bot): { headWet: boolean; oxygen: number | null } {
  const value = bot.oxygenLevel;
  return { headWet: headInWater(bot),
    oxygen: typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 20 ? value : null };
}

/** Release before another owner presses keys; a late continuation cannot release that owner's input. */
export function cancelControlInput(bot: Bot, reason: string, source: 'server' | 'local' = 'local'): void {
  const lease = inputs.get(bot);
  if (!lease) return;
  lease.finish();
  inputs.delete(bot);
  lease.reason = reason;
  lease.source = source;
  for (const key of lease.keys) bot.setControlState(key, false);
}

export async function skillControl(bot: Bot, call: Extract<SkillCall, { skill: 'control' }>, ctx: SkillContext): Promise<string> {
  checkAbort(ctx);
  if (!bot.entity?.position) throw new SkillBlocked('还没进入世界，不能直接控制');
  if (inputs.has(bot)) throw new SkillBlocked('上一段直接控制尚未交还身体');
  if (call.mode !== 'flight' && (!bot.physicsEnabled || flightState(bot).flying)) {
    throw new SkillBlocked('当前飞行尚未结束；继续空中移动用 mode:flight，地面控制前先 land');
  }
  if (call.mode === 'water' && (!bodyInWater(bot) || (bot as Bot & { vehicle?: unknown }).vehicle != null)) {
    throw new SkillBlocked('water 控制要求身体已在水中且未乘坐载具；先核对现场');
  }
  const start = bot.entity.position.clone();
  const startedAt = Date.now();
  const waterStart = call.mode === 'water' ? waterReadout(bot) : null;
  let waterEnd = waterStart;
  let maxDistance = 0;
  let stoppedAt: number | undefined;
  let last = { position: start, onGround: bot.entity.onGround, flying: flightState(bot).flying,
    yaw: bot.entity.yaw, pitch: bot.entity.pitch, at: startedAt };
  const sample = (): void => {
    if (stoppedAt !== undefined || !bot.entity?.position) return;
    last = { position: bot.entity.position.clone(), onGround: bot.entity.onGround, flying: flightState(bot).flying,
      yaw: bot.entity.yaw, pitch: bot.entity.pitch, at: Date.now() };
    if (waterStart) waterEnd = waterReadout(bot);
    maxDistance = Math.max(maxDistance, last.position.distanceTo(start));
  };
  const lease: InputLease = { keys: [], mode: call.mode, finish: () => { sample(); stoppedAt = Date.now(); } };
  inputs.set(bot, lease);
  const cancel = (reason: string, source: 'server' | 'local' = 'local'): void => {
    if (inputs.get(bot) === lease) cancelControlInput(bot, reason, source);
  };
  const onEnd = (): void => cancel('Minecraft 连接已结束', 'server');
  const onDeath = (): void => cancel('玩家已死亡', 'server');
  const onRespawn = (): void => cancel('维度或出生位置已变化', 'server');
  const onForcedMove = (): void => cancel('服务端修正了位置；重新观察后再控制', 'server');
  bot.on('end', onEnd);
  bot.on('death', onDeath);
  bot.on('respawn', onRespawn);
  bot.on('forcedMove', onForcedMove);
  const interrupted = (): boolean => !!lease.reason || ctx.aborted();
  const assertActive = (): void => {
    if (lease.reason) throw new SkillBlocked(lease.reason, [], lease.source);
    checkAbort(ctx);
    if (call.mode === 'water') {
      if (!bodyInWater(bot)) throw new SkillBlocked('已离开水体，停止水中输入；重新观察');
      const water = waterReadout(bot);
      if (!call.keys.includes('jump') && water.headWet && water.oxygen !== null && water.oxygen <= 6) {
        throw new SkillBlocked(`氧气 ${water.oxygen}/20，停止下潜；先上浮换气（surface）`);
      }
    }
  };
  const observed = (): string => {
    sample();
    const end = last.position;
    const xyz = (p: Vec3): string => `(${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)})`;
    return `实际起点${xyz(start)}→终点${xyz(end)}；位移${xyz(end.minus(start))}，最远偏移${maxDistance.toFixed(2)}格；`
      + `耗时${(stoppedAt ?? Date.now()) - startedAt}毫秒；观测于${new Date(last.at).toISOString()}；onGround:${last.onGround}，flying:${last.flying}；`
      + `当前朝向 yaw:${(last.yaw * 180 / Math.PI).toFixed(1)}° pitch:${(last.pitch * 180 / Math.PI).toFixed(1)}°`
      + (waterStart && waterEnd ? `；头部浸水:${waterStart.headWet}→${waterEnd.headWet}；氧气:${waterStart.oxygen ?? '未知'}→${waterEnd.oxygen ?? '未知'}/20` : '');
  };
  try {
    if (call.yawDeg !== undefined || call.pitchDeg !== undefined) {
      const yaw = bot.entity.yaw + (call.yawDeg ?? 0) * Math.PI / 180;
      const pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, bot.entity.pitch + (call.pitchDeg ?? 0) * Math.PI / 180));
      await bot.look(yaw, pitch, true);
    }
    assertActive();
    if (call.mode === 'flight') {
      await flyWithInput(bot, call.durationMs, interrupted, sample, () => {
        assertActive();
        lease.keys = call.keys;
        for (const key of lease.keys) bot.setControlState(key, true);
        return () => {
          if (inputs.get(bot) !== lease) return;
          for (const key of lease.keys) bot.setControlState(key, false);
          lease.keys = [];
        };
      });
    } else {
      // The previous passive tread may still hold jump even with no path active.
      // Include it in this lease so all exits release it without touching a new owner.
      if (call.mode === 'water') bot.setControlState('jump', false);
      lease.keys = call.mode === 'water' ? [...new Set<ControlKey>([...call.keys, 'jump'])] : call.keys;
      for (const key of call.keys) bot.setControlState(key, true);
      const until = Date.now() + call.durationMs;
      while (Date.now() < until) {
        assertActive();
        await sleep(Math.min(50, until - Date.now()));
        sample();
      }
    }
    assertActive();
    return `直接控制结束（${call.mode}，${call.keys.join('+') || (call.mode === 'water' ? '松键自然下沉' : '仅转头')}；客户端观测）；${observed()}；按键已释放，到达目标须按现场或 expect 另行核验`;
  } catch (error) {
    if (error instanceof SkillBlocked) {
      throw new SkillBlocked(lease.reason ?? error.message, [...error.scene, observed()], lease.source ?? error.source, error.code);
    }
    throw error;
  } finally {
    ctx.diag?.write({ lane: 'body', event: 'control-ended', taskId: ctx.taskId,
      msg: observed(), data: { call, interruptedBy: lease.reason ?? ctx.abortedBy?.() ?? null } });
    cancel('直接控制结束');
    bot.off('end', onEnd);
    bot.off('death', onDeath);
    bot.off('respawn', onRespawn);
    bot.off('forcedMove', onForcedMove);
  }
}
