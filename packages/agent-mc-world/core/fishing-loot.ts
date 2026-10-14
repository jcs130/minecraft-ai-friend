import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import pathfinderPkg from 'mineflayer-pathfinder';
import { FISH_LOOT_WAIT_MS, lastFishingReel, type FishingReel } from './fishing.ts';
import { INVENTORY_SLOTS, invSnapshot } from './inventory.ts';
import { zhName } from './names.ts';
import { checkAbort, sleep, SkillBlocked, type SkillContext } from './skill-context.ts';
import { standableCell } from './placement.ts';
import { dropGoal, gotoGoal, walkOnlyPath } from './travel.ts';

const { goals } = pathfinderPkg;

const STABLE_MS = 300;
const RECOVERY_HAZARDS = new Set(['fire', 'soul_fire', 'powder_snow', 'cactus', 'magma_block', 'sweet_berry_bush', 'wither_rose']);

/** One cast's close-range collection, never a recast or a new objective. */
export async function confirmFishingLoot(bot: Bot, ctx: SkillContext): Promise<string> {
  const reel = lastFishingReel(bot);
  if (!reel) throw new SkillBlocked('抛竿已返回，但没有本次浮标的收线证据；鱼获未确认', [], 'server', 'fishing-loot-unconfirmed');
  let stableKey = '', since = Date.now();
  let recovered = false;
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
    if (!recovered && Date.now() - reel.at >= 1_200) {
      const drop = [...reel.drops.values()].find(x => x.name !== 'item' && x.collectedBy === null
        && bot.entities[x.entity.id] === x.entity && x.entity.position.distanceTo(bot.entity.position) <= 4);
      if (drop) {
        recovered = true;
        await recoverFishingDrop(bot, ctx, reel, drop.entity);
        checkAbort(ctx);
      }
    }
    await sleep(100);
  }
  checkAbort(ctx);
  const gains = gained();
  const reason = gains.length
    ? `收线后背包净增${gains.map(x => `${zhName(x.name)}×${x.count}`).join('、')}，但未确认是本次浮标附近掉落物由本人拾取`
    : '已收到咬钩信号并收线，但未确认物品稳定入包';
  throw new SkillBlocked(`${reason}；已核对${FISH_LOOT_WAIT_MS / 1000}秒，本次鱼获未确认`, fishingLootScene(bot, reel), 'server', 'fishing-loot-unconfirmed');
}

/** Only a short, completely loaded dry path to this observed drop; never dig, place, dive or leave a vehicle. */
async function recoverFishingDrop(bot: Bot, ctx: SkillContext, reel: FishingReel, entity: Bot['entity']): Promise<void> {
  if (!bot.pathfinder?.getPathTo || !bot.pathfinder.movements || (bot as Bot & { vehicle?: unknown }).vehicle) return;
  const end = Math.min(reel.at + FISH_LOOT_WAIT_MS - STABLE_MS, Date.now() + 2_500);
  const release = walkOnlyPath(bot);
  let stop: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  try {
    const pos = entity.position;
    const candidates: Vec3[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = 0; dy <= 1; dy++) {
      const c = new Vec3(Math.floor(pos.x) + dx, Math.floor(pos.y) + dy, Math.floor(pos.z) + dz);
      if (standableCell(bot, c) && Math.abs(c.x + .5 - pos.x) <= 1.3 && Math.abs(c.z + .5 - pos.z) <= 1.3
        && pos.y >= c.y - .4 && pos.y <= c.y + 2 && c.offset(.5, 0, .5).distanceTo(bot.entity.position) <= 4) candidates.push(c);
    }
    candidates.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
    for (const cell of candidates.slice(0, 4)) {
      checkAbort(ctx);
      if (Date.now() >= end) return;
      const goal = new goals.GoalBlock(cell.x, cell.y, cell.z);
      const route = bot.pathfinder.getPathTo(bot.pathfinder.movements, goal, 75);
      if (route.status !== 'success' || route.path.length > 8 || !route.path.every(node => {
        const p = new Vec3(node.x, node.y, node.z).floored();
        const feet = bot.blockAt(p), head = bot.blockAt(p.offset(0, 1, 0)), below = bot.blockAt(p.offset(0, -1, 0));
        return standableCell(bot, p) && !node.toBreak.length && !node.toPlace.length
          && [feet, head, below].every(b => b && !RECOVERY_HAZARDS.has(b.name));
      })) continue;
      const local = { ...ctx, aborted: () => ctx.aborted() || stopped
        || !!bot.pathfinder.goal && bot.pathfinder.goal !== goal };
      let finishWait!: () => void;
      const cancelled = new Promise<void>(resolve => { finishWait = resolve; });
      stop = setInterval(() => {
        const foot = bot.blockAt(bot.entity.position.floored());
        if (!ctx.aborted() && Date.now() < end && bot.entities[entity.id] === entity
          && reel.drops.get(entity.id)?.collectedBy === null && foot
          && !['water', 'lava'].includes(foot.name) && !RECOVERY_HAZARDS.has(foot.name)) return;
        stopped = true;
        // A reflex may already own a different goal. Only cancel our exact goal object.
        if (bot.pathfinder.goal === goal) dropGoal(bot, 'task', '钓鱼近岸回收结束', ctx.diag);
        finishWait();
      }, 50);
      try { await Promise.race([gotoGoal(bot, goal, local), cancelled]); }
      catch { checkAbort(ctx); } // Keep the original harvest evidence if this optional route fails.
      return;
    }
  } finally { if (stop) clearInterval(stop); release(); }
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
