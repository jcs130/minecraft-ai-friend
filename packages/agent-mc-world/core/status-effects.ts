/** Mineflayer 保留收到的初始时长；剩余刻数按收包时间估算，移除仍由服务端确认。 */
import type { EventEmitter } from 'node:events';

interface TimedEffect { duration: number }
interface EffectEntity { effects?: Record<number, TimedEffect> }
type EffectBot = Pick<EventEmitter, 'on'> & {
  entity?: EffectEntity;
  entities?: Record<string, EffectEntity>;
};

const received = new WeakMap<TimedEffect, { duration: number; receivedAtMs: number }>();
const observed = new WeakSet<EffectBot>();

function record(effect: TimedEffect, receivedAtMs = Date.now()): void {
  received.set(effect, { duration: effect.duration, receivedAtMs });
}

export function remainingEffectTicks(effect: TimedEffect, nowMs = Date.now()): number {
  let timing = received.get(effect);
  if (!timing || timing.duration !== effect.duration) {
    record(effect, nowMs);
    timing = received.get(effect)!;
  }
  if (effect.duration < 0) return effect.duration;
  const elapsedTicks = Math.floor(Math.max(0, nowMs - timing.receivedAtMs) / 50);
  return Math.max(0, effect.duration - elapsedTicks);
}

/** 一个连接安装一次；重复续效包重新计时，同一效果的快照和网页重放不重置时间。 */
export function observeStatusEffects(bot: EffectBot): void {
  if (observed.has(bot)) return;
  observed.add(bot);
  for (const entity of [bot.entity, ...Object.values(bot.entities ?? {})]) {
    for (const effect of Object.values(entity?.effects ?? {})) {
      if (!received.has(effect)) record(effect);
    }
  }
  bot.on('entityEffect', (_entity: unknown, effect: TimedEffect) => record(effect));
}
