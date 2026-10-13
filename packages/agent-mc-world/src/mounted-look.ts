/** Mineflayer passenger look completes without waiting for suspended walking physics. */
import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';

const require = createRequire(import.meta.url);
const conversions = require('mineflayer/lib/conversions.js') as {
  toNotchianYaw(value: number): number;
  toNotchianPitch(value: number): number;
};
const installed = new WeakMap<Bot, () => void>();

/** Mount pauses Mineflayer's updatePosition, which normally resolves look and sends rotation. */
export function installMountedLook(bot: Bot): () => void {
  const existing = installed.get(bot);
  if (existing) return existing;
  const original = bot.look;
  const wrapped: Bot['look'] = async function (yaw, pitch, force) {
    if (!(bot as Bot & { vehicle?: Bot['entity'] | null }).vehicle)
      return original.call(bot, yaw, pitch, force);
    await original.call(bot, yaw, pitch, true);
    const onGround = bot.entity.onGround;
    bot._client.write('look', {
      yaw: Math.fround(conversions.toNotchianYaw(bot.entity.yaw)),
      pitch: Math.fround(conversions.toNotchianPitch(bot.entity.pitch)),
      onGround,
      flags: { onGround, hasHorizontalCollision: undefined },
    });
  };
  bot.look = wrapped;
  const restore = (): void => {
    if (bot.look === wrapped) bot.look = original;
    installed.delete(bot);
  };
  installed.set(bot, restore);
  return restore;
}
