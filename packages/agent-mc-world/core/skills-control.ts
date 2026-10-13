/** Short input sequences share the executor's body ownership and report observed movement. */
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { flightState, flyWithInput } from './flight.ts';
import { SkillBlocked, checkAbort, sleep, type SkillContext } from './skill-context.ts';
import type { ControlKey, SkillCall } from './skills.ts';

interface InputLease {
  keys: ControlKey[];
  finish: () => void;
  reason?: string;
  source?: 'server' | 'local';
}
const inputs = new WeakMap<Bot, InputLease>();

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
  if (call.mode === 'ground' && (!bot.physicsEnabled || flightState(bot).flying)) {
    throw new SkillBlocked('当前飞行尚未结束；继续空中移动用 mode:flight，地面控制前先 land');
  }
  const start = bot.entity.position.clone();
  const startedAt = Date.now();
  let maxDistance = 0;
  let stoppedAt: number | undefined;
  let last = { position: start, onGround: bot.entity.onGround, flying: flightState(bot).flying,
    yaw: bot.entity.yaw, pitch: bot.entity.pitch, at: startedAt };
  const sample = (): void => {
    if (stoppedAt !== undefined || !bot.entity?.position) return;
    last = { position: bot.entity.position.clone(), onGround: bot.entity.onGround, flying: flightState(bot).flying,
      yaw: bot.entity.yaw, pitch: bot.entity.pitch, at: Date.now() };
    maxDistance = Math.max(maxDistance, last.position.distanceTo(start));
  };
  const lease: InputLease = { keys: [], finish: () => { sample(); stoppedAt = Date.now(); } };
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
  };
  const observed = (): string => {
    sample();
    const end = last.position;
    const xyz = (p: Vec3): string => `(${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)})`;
    return `实际起点${xyz(start)}→终点${xyz(end)}；位移${xyz(end.minus(start))}，最远偏移${maxDistance.toFixed(2)}格；`
      + `耗时${(stoppedAt ?? Date.now()) - startedAt}毫秒；观测于${new Date(last.at).toISOString()}；onGround:${last.onGround}，flying:${last.flying}；`
      + `当前朝向 yaw:${(last.yaw * 180 / Math.PI).toFixed(1)}° pitch:${(last.pitch * 180 / Math.PI).toFixed(1)}°`;
  };
  try {
    if (call.yawDeg !== undefined || call.pitchDeg !== undefined) {
      const yaw = bot.entity.yaw + (call.yawDeg ?? 0) * Math.PI / 180;
      const pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, bot.entity.pitch + (call.pitchDeg ?? 0) * Math.PI / 180));
      await bot.look(yaw, pitch, true);
    }
    assertActive();
    if (call.mode === 'flight') {
      const forward = Number(call.keys.includes('forward')) - Number(call.keys.includes('back'));
      const left = Number(call.keys.includes('left')) - Number(call.keys.includes('right'));
      const up = Number(call.keys.includes('jump')) - Number(call.keys.includes('sneak'));
      const yaw = bot.entity.yaw;
      const direction = new Vec3(-Math.sin(yaw) * forward - Math.cos(yaw) * left, up,
        -Math.cos(yaw) * forward + Math.sin(yaw) * left);
      await flyWithInput(bot, direction, call.durationMs, interrupted, sample);
    } else {
      lease.keys = call.keys;
      for (const key of lease.keys) bot.setControlState(key, true);
      const until = Date.now() + call.durationMs;
      while (Date.now() < until) {
        assertActive();
        await sleep(Math.min(50, until - Date.now()));
        sample();
      }
    }
    assertActive();
    return `直接控制结束（${call.mode}，${call.keys.join('+') || '仅转头'}；客户端观测）；${observed()}；按键已释放，到达目标须按现场或 expect 另行核验`;
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
