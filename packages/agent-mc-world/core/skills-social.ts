import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { canSeeEntity } from './terrain.ts';
import { SkillBlocked, checkAbort, sleep, type SkillContext } from './skill-context.ts';
import type { SkillCall } from './skills.ts';

type Gesture = Extract<SkillCall, { skill: 'gesture' }>;

/** The action only uses packets that ordinary Java clients already render. */
export async function skillGesture(bot: Bot, call: Gesture, ctx: SkillContext): Promise<string> {
  checkAbort(ctx);
  if (ctx.bodyState?.().combatActive) throw new SkillBlocked('正在战斗，暂时不能做社交动作');
  const player = bot.players[call.name];
  const target = player?.entity;
  if (!target || target.type !== 'player' || target.isValid === false) {
    throw new SkillBlocked(`当前看不到玩家 ${call.name}，不能对空处做动作`);
  }
  const distance = bot.entity.position.distanceTo(target.position);
  if (distance > 6 || !canSeeEntity(bot, target)) {
    throw new SkillBlocked(`玩家 ${call.name} 不在 6 格内的视线中；先走近并确认没有墙遮挡`);
  }
  if ((call.motion === 'wave' || call.motion === 'beckon') && bot.heldItem) {
    throw new SkillBlocked('挥手或招手前先把主手腾空，避免拿着工具或武器挥动');
  }

  const eyes = target.position.offset(0, Math.min(target.height ?? 1.8, 1.62), 0);
  await bot.lookAt(eyes);
  checkAbort(ctx);
  if (call.motion === 'wave') {
    bot.swingArm('right');
    await sleep(420);
    checkAbort(ctx);
    bot.swingArm('right');
    return `面向 ${call.name} 挥了两下手；没有攻击或发送聊天`;
  }
  if (call.motion === 'bow') {
    const wasSneaking = bot.getControlState('sneak');
    if (!wasSneaking) bot.setControlState('sneak', true);
    try {
      await sleep(460);
      checkAbort(ctx);
    } finally {
      if (!wasSneaking) bot.setControlState('sneak', false);
    }
    return `面向 ${call.name} 短暂蹲下致意；没有发送聊天`;
  }
  if (call.motion === 'beckon') {
    const wasSneaking = bot.getControlState('sneak');
    let crouched = false;
    bot.swingArm('right');
    try {
      await sleep(260);
      checkAbort(ctx);
      if (!wasSneaking) {
        bot.setControlState('sneak', true);
        crouched = true;
      }
      await sleep(220);
      checkAbort(ctx);
    } finally {
      if (crouched) bot.setControlState('sneak', false);
    }
    bot.swingArm('right');
    return `面向 ${call.name} 招了招手并短暂蹲下；没有移动或发送聊天`;
  }
  if (call.motion === 'shake_head') {
    const { yaw, pitch } = bot.entity;
    try {
      await bot.look(yaw - 0.32, pitch, true);
      await sleep(170);
      checkAbort(ctx);
      await bot.look(yaw + 0.32, pitch, true);
      await sleep(170);
      checkAbort(ctx);
    } finally {
      await bot.look(yaw, pitch, true).catch(() => undefined);
    }
    return `面向 ${call.name} 摇了摇头；没有发送聊天`;
  }
  await bot.lookAt(new Vec3(eyes.x, eyes.y - 0.45, eyes.z));
  await sleep(180);
  checkAbort(ctx);
  await bot.lookAt(eyes);
  return `面向 ${call.name} 点了点头；没有发送聊天`;
}
