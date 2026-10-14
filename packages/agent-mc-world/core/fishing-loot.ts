import type { Bot } from 'mineflayer';
import { FISH_LOOT_WAIT_MS, lastFishingReel, type FishingReel } from './fishing.ts';
import { INVENTORY_SLOTS, invSnapshot } from './inventory.ts';
import { zhName } from './names.ts';
import { checkAbort, sleep, SkillBlocked, type SkillContext } from './skill-context.ts';

const STABLE_MS = 300;

/** Observe only: do not recast, walk towards an unverified drop or choose the next goal. */
export async function confirmFishingLoot(bot: Bot, ctx: SkillContext): Promise<string> {
  const reel = lastFishingReel(bot);
  if (!reel) throw new SkillBlocked('抛竿已返回，但没有本次浮标的收线证据；鱼获未确认', [], 'server', 'fishing-loot-unconfirmed');
  let stableKey = '', since = Date.now();
  const gained = () => [...invSnapshot(bot)].flatMap(([name, count]) => {
    const n = count - (reel.before.get(name) ?? 0);
    return n > 0 ? [{ name, count: n }] : [];
  });
  while (Date.now() - reel.at < FISH_LOOT_WAIT_MS) {
    checkAbort(ctx);
    const self = new Map<string, number>();
    for (const drop of reel.drops.values()) if (drop.collectedBy === bot.entity.id && drop.name !== 'item')
      self.set(drop.name, (self.get(drop.name) ?? 0) + drop.count);
    const confirmed = gained().flatMap(item => {
      const n = Math.min(item.count, self.get(item.name) ?? 0);
      return n > 0 ? [`${zhName(item.name)}×${n}`] : [];
    }).sort();
    const key = JSON.stringify(confirmed);
    if (key !== stableKey) { stableKey = key; since = Date.now(); }
    if (confirmed.length && Date.now() - since >= STABLE_MS) return confirmed.join('、');
    await sleep(100);
  }
  checkAbort(ctx);
  const gains = gained();
  const reason = gains.length
    ? `收线后背包净增${gains.map(x => `${zhName(x.name)}×${x.count}`).join('、')}，但未确认是本次浮标附近掉落物由本人拾取`
    : '已收到咬钩信号并收线，但未确认物品稳定入包';
  throw new SkillBlocked(`${reason}；已核对${FISH_LOOT_WAIT_MS / 1000}秒，本次鱼获未确认`, fishingLootScene(bot, reel), 'server', 'fishing-loot-unconfirmed');
}

function fishingLootScene(bot: Bot, reel: FishingReel): string[] {
  const p = bot.entity.position, hook = reel.hook;
  const scene = [`本次浮标#${hook.id}收线点(${hook.x.toFixed(1)},${hook.y.toFixed(1)},${hook.z.toFixed(1)})；`
    + `本人脚下比收线点高${(p.y - hook.y).toFixed(1)}格，水平距${Math.hypot(p.x - hook.x, p.z - hook.z).toFixed(1)}格`,
    `背包空槽${Math.max(0, INVENTORY_SLOTS - bot.inventory.items().length)}/${INVENTORY_SLOTS}；已有同类堆叠能否容纳另行核对`,
    '附近新掉落物只是时空关联，不代表服务端确认其归属；鱼获需本人拾取和背包稳定净增同时确认'];
  for (const drop of [...reel.drops.values()].slice(0, 6)) {
    const pos = drop.entity.position;
    scene.push(`收线后附近新掉落物#${drop.entity.id} ${zhName(drop.name)}×${drop.count}，`
      + `最后坐标(${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)})；`
      + (drop.collectedBy === bot.entity.id ? '收到本人拾取事件，但背包净增未确认'
        : drop.collectedBy !== null ? `收到实体#${drop.collectedBy}拾取事件，未计为本人鱼获`
          : bot.entities[drop.entity.id] === drop.entity ? '仍可见，未收到拾取事件' : '已离开实体读数，去向未确认'));
  }
  if (!reel.drops.size) scene.push('未观察到收线点附近新掉落物，掉落去向未知');
  scene.push('先核对掉落位置、背包空位与岸边站位，再决定拾取、换站位或重试；无需把收线成功当作获得物品');
  return scene;
}
