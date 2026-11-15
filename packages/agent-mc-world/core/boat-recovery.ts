import type { Bot } from 'mineflayer';
import { canSeeEntity } from './terrain.ts';
import { checkAbort, sleep, SkillBlocked, type SkillContext } from './skill-context.ts';

/** Explicit empty-boat recovery, never the combat target selector or an auto-dismount. */
export async function recoverBoat(bot: Bot, entityId: number, ctx: SkillContext): Promise<string> {
  const mounted = () => (bot as Bot & { vehicle?: unknown }).vehicle;
  if (mounted()) throw new SkillBlocked('先确认安全岸点并下船，再回收空船；本次未攻击');
  const boat = bot.entities[entityId];
  if (!boat || boat.name !== 'boat' || !boat.isValid) throw new SkillBlocked('点名的普通船已不可见；没有改打附近同类，先核对掉落物与库存');
  const counts = () => bot.inventory.items().filter(i => /_boat$|_raft$/.test(i.name) && !i.name.includes('chest'))
    .reduce((sum, i) => sum + i.count, 0);
  const before = counts(); let hits = 0;
  const requireEmptyGroundedBoat = () => {
    const reasons: string[] = [];
    if (mounted()) reasons.push('自己当前仍乘坐载具');
    if (bot.entity.onGround !== true) reasons.push('自己尚未确认着地');
    if (!Array.isArray(boat.passengers)) reasons.push('船的乘客名单未同步');
    const passengers = [...(Array.isArray(boat.passengers) ? boat.passengers : []),
      ...Object.values(bot.entities).filter(e => e?.vehicle === boat)];
    if (passengers.length) reasons.push(`船已有乘客（实体编号 ${[...new Set(passengers.map(e => e.id))].slice(0, 4).join('、')}）`);
    if (reasons.length) throw new SkillBlocked(`回收前提未满足：${reasons.join('；')}。已停止，未攻击；未报告的条件不是失败原因，不推测乘客身份。`);
  };
  for (; hits < 8; hits++) {
    checkAbort(ctx);
    if (bot.entities[entityId] !== boat || !boat.isValid) break;
    requireEmptyGroundedBoat();
    if (boat.position.distanceTo(bot.entity.position) > 3 || !canSeeEntity(bot, boat))
      throw new SkillBlocked('点名空船不在3格内可见范围，未追船；在岸边重新观察落点');
    await bot.lookAt(boat.position.offset(0, .3, 0)); checkAbort(ctx);
    // Revalidate after the awaited look; a passenger may have boarded meanwhile.
    if (bot.entities[entityId] !== boat || !boat.isValid) break;
    requireEmptyGroundedBoat();
    bot.attack(boat); await sleep(350);
  }
  checkAbort(ctx);
  if (bot.entities[entityId] === boat && boat.isValid) throw new SkillBlocked(`空船仍在（尝试${hits}次），服务端未确认破坏；没有无限攻击`, [], 'server');
  await sleep(250); checkAbort(ctx);
  const gained = counts() - before;
  return `点名空船 entityId=${entityId} 已从当前实体列表消失；随身普通船净变化 ${gained >= 0 ? '+' : ''}${gained}。`
    + (gained > 0 ? '观察到船物品增加，按具体物品回读核验。' : '尚未确认收进背包；先观察掉落物，再用 pickup 点名原船物品，不能把消失当作已回收。');
}
