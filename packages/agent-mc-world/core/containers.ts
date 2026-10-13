/**
 * 容器与工作站的窗口:找到哪一个、开得稳、槽位怎么排、这一次看见了什么记进账本。
 *
 * 只管开窗与读写槽位,存什么取什么由技能族决定。
 */
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { type Cell } from './geometry.ts';
import { SkillBlocked, checkAbort, sleep, type SkillContext } from './skill-context.ts';
import { reachCell } from './travel.ts';
import { blockAtCell, cellText, dimensionOf } from './cell-facts.ts';
import { zhName } from './names.ts';
import { moveExactSlot, playerInvIn, type InvPred } from './inventory.ts';
import { readDurability, readEnchants, readPotionName, type EnchantRegistry, type ItemLike } from './item-facts.ts';
import { itemCustomName } from './item-display.ts';
import {
  CONTAINER_FIND, ChestBook, FURNACE_KINDS, chestBlockName, hasItem, hasRoom, type ChestRecord,
} from './chests.ts';
import { type ItemStack } from './terrain.ts';
import { contentsText } from './receipt.ts';
import { selectionMenuTitle } from './window-semantics.ts';


/** 三种磨损态的铁砧都认 */
export const ANVIL_BLOCKS = ['anvil', 'chipped_anvil', 'damaged_anvil'] as const;
/** 找工作方块的半径,与 smelt 找炉子一个量级 */
export const STATION_FIND_R = 16;
/** 放料/取货后等服务端回灌窗口槽位 */
export const WINDOW_SETTLE_MS = 600;

export interface StationWindow {
  id: number;
  type: string;
  slots: Array<{ name: string; type: number; count: number } | null>;
  inventoryStart: number;
  inventoryEnd: number;
}

export function findStationCell(bot: Bot, names: readonly string[]): Cell | null {
  const reg = bot.registry.blocksByName as unknown as Record<string, { id: number } | undefined>;
  const ids = names.map((n) => reg[n]?.id).filter((n): n is number => typeof n === 'number');
  if (ids.length === 0) return null;
  const found = bot.findBlocks({ matching: ids, maxDistance: STATION_FIND_R, count: 1 });
  return found.length > 0 ? { x: found[0].x, y: found[0].y, z: found[0].z } : null;
}

/** 走到 cell、开它的窗;那一格不是这种工作方块当场说清 */
export async function openStationWindow(
  bot: Bot, ctx: SkillContext, cell: Cell, blockNames: readonly string[], zhStation: string,
): Promise<{ win: StationWindow; blockName: string }> {
  await reachCell(bot, cell, ctx);
  checkAbort(ctx);
  const block = blockAtCell(bot, cell);
  if (!block) throw new SkillBlocked(`${cellText(cell)} 所在区块没加载`);
  if (!blockNames.includes(block.name)) {
    throw new SkillBlocked(`${cellText(cell)} 那一格是${zhName(block.name)},不是${zhStation}`);
  }
  const open = () => (bot as unknown as { openBlock(b: unknown): Promise<StationWindow> }).openBlock(block);
  const expectedType = blockNames.some((name) => name.endsWith('anvil')) ? 'anvil' : 'grindstone';
  const matches = (win: StationWindow) => String(win.type).replace(/^minecraft:/, '') === expectedType;
  let win = await openWindowGuarded(bot, ctx, open);
  if (!matches(win)) {
    ctx.diag?.write({ lane: 'skill', event: 'station-window-mismatch', incident: true,
      msg: `打开${zhStation}却收到${win.type}窗口，关闭后重开一次`,
      data: { expectedType, actualType: String(win.type), windowId: win.id } });
    bot.closeWindow(win as Parameters<Bot['closeWindow']>[0]);
    await sleep(300);
    checkAbort(ctx);
    win = await open();
    if (!matches(win)) {
      bot.closeWindow(win as Parameters<Bot['closeWindow']>[0]);
      throw new SkillBlocked(`打开${zhStation}却连续收到${win.type}窗口；已关闭错窗，没有移动物品。等服务端窗口同步后再试`, [], 'server');
    }
  }
  return { win, blockName: block.name };
}

/**
 * 把包里符合判据的一件挪进窗口的某个格。
 *
 * 找料照**开着的那扇窗**自己的账读(见 playerInvIn),槽位号也只在那扇窗里成立。
 * 一格一件的按槽位挪(见 moveExactSlot):`transfer` 按类型找槽,同 id 的几件在它
 * 眼里没有分别,点名挑的那一件就白挑了。
 */
export async function putIntoStation(
  bot: Bot, win: StationWindow, pred: InvPred, destSlot: number, asked: string,
): Promise<void> {
  const occupying = win.slots[destSlot];
  if (occupying) {
    throw new SkillBlocked(`工作站输入格 ${destSlot + 1} 已有${itemCustomName(occupying) ?? zhName(occupying.name)}，不能再放${asked}；先关窗等物品回包并核对窗口，不要为此丢背包物品`, [], 'server');
  }
  const item = playerInvIn(bot, win).items().find((i) => pred(i.name, i));
  if (!item) throw new SkillBlocked(`包里没有${asked}`);
  try {
    if (item.count === 1) {
      await moveExactSlot(bot, item.slot, destSlot);
      return;
    }
    await (bot as unknown as { transfer(o: Record<string, unknown>): Promise<void> }).transfer({
      window: win, itemType: item.type, metadata: null, count: 1,
      sourceStart: win.inventoryStart, sourceEnd: win.inventoryEnd,
      destStart: destSlot, destEnd: destSlot + 1,
    });
  } catch (err) {
    const message = (err as Error).message;
    if (!/destination full|invalid operation/i.test(message)) throw err;
    const now = win.slots[destSlot];
    throw new SkillBlocked(
      `工作站输入格 ${destSlot + 1} 放不进${asked}`
      + (now ? `，格里现在是${itemCustomName(now) ?? zhName(now.name)}` : '，窗口槽位状态可能还没同步')
      + '；这不是背包空位的判据，不要丢物品腾格。先关窗等服务端回灌再核对',
      [], 'server',
    );
  }
}

/** 一件东西的读数:耐久 + 附魔,回执格式统一 */
export function stationItemFacts(bot: Bot, item: { name: string } | null): string {
  if (!item) return '';
  const parts: string[] = [];
  const dur = readDurability(item as never);
  if (dur) parts.push(`耐久 ${dur.left}/${dur.max}`);
  const ench = readEnchants(item as never, bot.registry as never);
  parts.push(ench.length > 0 ? `附魔 ${ench.map((e) => `${e.name}${e.level}`).join('、')}` : '没有附魔');
  return parts.join(',');
}

export function findContainers(bot: Bot, range: number): Array<{ x: number; y: number; z: number; name: string; d: number }> {
  const registry = bot.registry?.blocksByName as Record<string, { id: number } | undefined> | undefined;
  if (!registry || !bot.entity?.position || typeof bot.findBlocks !== 'function' || typeof bot.blockAt !== 'function') return [];
  const ids = CONTAINER_FIND
    .map((n) => registry[n]?.id)
    .filter((id): id is number => id !== undefined);
  if (ids.length === 0) return [];
  const me = bot.entity.position;
  const found = bot.findBlocks({ matching: ids, maxDistance: range, count: 16 });
  const out: Array<{ x: number; y: number; z: number; name: string; d: number }> = [];
  for (const p of found) {
    const b = bot.blockAt(p);
    if (!b) continue;
    out.push({ x: p.x, y: p.y, z: p.z, name: b.name, d: p.distanceTo(me) });
  }
  out.sort((a, b) => a.d - b.d);
  return out;
}

/**
 * 报告本维度账本中最近箱子的上次观测位置与取整直线距离；没有则返回 null。
 * 不跨维度比较坐标，也不决定走过去或放新箱子。
 */
export function knownChestNote(bot: Bot, chests: ChestBook | undefined): string | null {
  const me = bot.entity.position;
  let best: { rec: ChestRecord; d: number } | null = null;
  for (const rec of chests?.chestsIn(dimensionOf(bot)) ?? []) {
    const d = Math.hypot(rec.x - me.x, rec.y - me.y, rec.z - me.z);
    if (!best || d < best.d) best = { rec, d };
  }
  if (!best) return null;
  const r = best.rec;
  const origin = r.placedAt !== undefined ? '你放的' : '你开过的';
  return `;账上本维度最近的是${origin}${zhName(chestBlockName(r))}`
    + ` (${r.x}, ${r.y}, ${r.z}),直线 ${Math.round(best.d)} 格(上次看见)`;
}

/** 附近一个容器都扫不到:两处(stow / take)共用同一句措辞与同一段账本补注 */
export function noContainerNearby(bot: Bot, ctx: SkillContext): SkillBlocked {
  return new SkillBlocked(`32 格内没有箱子${knownChestNote(bot, ctx.chests) ?? ''}`);
}

/**
 * 箱内容按「名字 + 附魔」并栈,与背包同一条线(原版里带不同附魔的同名物品不能堆叠)。
 * 只按名字并,五本各不相同的附魔书会念成「附魔书×5」:数量读得到,哪一本在里面读不到,
 * 于是也点不了名(见 item-pick)。
 */
export function containerStacks(win: {
  containerItems?: () => Array<ItemLike & { count: number }>;
  slots?: Array<(ItemLike & { count: number }) | null>;
  inventoryStart?: number;
}, registry?: EnchantRegistry | null): { items: ItemStack[]; usedSlots: number; slots: number } {
  const raw = typeof win.containerItems === 'function'
    ? win.containerItems()
    : (win.slots ?? []).slice(0, win.inventoryStart ?? 27).filter((s): s is ItemLike & { count: number } => s != null);
  const merged = new Map<string, ItemStack>();
  for (const it of raw) {
    const ench = readEnchants(it as never, registry as never);
    const potion = readPotionName(it as never);
    const displayName = itemCustomName(it);
    const durability = readDurability(it);
    const key = JSON.stringify([it.name, displayName, ench, potion, durability]);
    const cur = merged.get(key);
    if (cur) cur.count += it.count;
    else {
      merged.set(key, {
        name: it.name, count: it.count,
        ...(displayName ? { displayName } : {}), ...(durability ? { durability } : {}),
        ...(ench.length > 0 ? { enchantments: ench } : {}), ...(potion ? { potion } : {}),
      });
    }
  }
  return {
    items: [...merged.values()],
    usedSlots: raw.length,
    slots: win.inventoryStart ?? 27,
  };
}

export function rememberChest(
  ctx: SkillContext,
  bot: Bot,
  pos: { x: number; y: number; z: number },
  win: Parameters<typeof containerStacks>[0],
): { items: ItemStack[]; usedSlots: number; slots: number } {
  const snap = containerStacks(win, bot.registry as never);
  const route = storageObservations.get(bot)?.get(containerKey(bot, pos));
  if (route) {
    route.access = undefined;
    route.routeFail = undefined;
    // A later window observation supersedes an earlier no-room refusal. Keep
    // protection and other server refusals until a successful write confirms them.
    if (route.write && snap.usedSlots < snap.slots) {
      for (const [item, failure] of route.write) {
        if (/没空位|已满|full/i.test(failure.why)) route.write.delete(item);
      }
    }
  }
  ctx.chests?.remember(dimensionOf(bot), pos, snap.items, snap.usedSlots, snap.slots);
  return snap;
}

/**
 * 原版烧一件的耗时:熔炉 200 刻(10 秒);高炉与烟熏炉减半(100 刻)。
 * 这是确定性数值,所以熔炉的到期**可以**估;作物不行(随机刻),别把这条挪去作物。
 */
export function smeltPerItemMs(blockName: string): number {
  return blockName === 'furnace' ? 10_000 : 5_000;
}

/** 槽位有料不能证明正在烧炼;估时需要炉火和进度读数同时确认。 */
export function furnaceDoneAt(win: unknown, input: ItemStack | null, blockName: string, now: number): number | null {
  const { fuel, progress } = win as { fuel?: number | null; progress?: number | null };
  return input && typeof fuel === 'number' && fuel > 0 && typeof progress === 'number' && progress > 0
    ? now + (input.count - progress) * smeltPerItemMs(blockName)
    : null;
}

/** 窗口 slots 里的一格转成账本的 ItemStack;空格与读不出都算 null */
export function slotStack(win: unknown, i: number): ItemStack | null {
  const slots = (win as { slots?: Array<{ name?: string; count?: number } | null> }).slots;
  const s = slots?.[i];
  return s && typeof s.name === 'string' && typeof s.count === 'number'
    ? containerStacks({ containerItems: () => [s as ItemLike & { count: number }] }).items[0] ?? null
    : null;
}

/**
 * 窗口属性(craft_progress_bar)按窗口号记最后一次的值。原版在开窗后紧跟着推送,
 * 技能拿到窗口时往往已经推完,临时挂监听会漏,所以一条连接挂一次常驻的。
 * 同号窗口重开(open_window)时清掉旧值。
 */
const windowProps = new WeakMap<object, Map<number, Map<number, number>>>();

export function trackWindowProps(bot: Bot): void {
  const byWindow = new Map<number, Map<number, number>>();
  windowProps.set(bot, byWindow);
  const client = (bot as unknown as { _client: { on(n: string, f: (p: Record<string, number>) => void): void } })._client;
  client.on('open_window', (p) => { byWindow.delete(p.windowId); });
  client.on('craft_progress_bar', (p) => {
    let props = byWindow.get(p.windowId);
    if (!props) byWindow.set(p.windowId, props = new Map());
    props.set(p.property, p.value);
  });
}

/** 这扇窗口某条属性最后收到的值;没收到过返回 null */
export function windowProp(bot: Bot, win: { id?: number }, property: number): number | null {
  if (win.id === undefined) return null;
  return windowProps.get(bot)?.get(win.id)?.get(property) ?? null;
}

/** 酿造台窗口属性:0 = 剩余酿造刻(400 起倒数,0 = 没在酿),1 = 剩余燃料轮数(0–20) */
export const BREW_PROP_TIME = 0;
export const BREW_PROP_FUEL = 1;
/** 酿造台的窗口槽位(原版固定):0-2 三个瓶位,3 材料位,4 燃料位 */
export const BREW_BOTTLE_SLOTS = [0, 1, 2] as const;
export const BREW_INPUT_SLOT = 3;
export const BREW_FUEL_SLOT = 4;

/** 一件药水念成「药水(水瓶)×1」;不是药水就只有名字和数量 */
export function potionText(stack: ItemLike & { count: number } | null): string {
  if (!stack) return '空';
  const potion = readPotionName(stack as never);
  return `${itemCustomName(stack) ?? zhName(stack.name)}${potion === null ? '' : `(${potion})`}×${stack.count}`;
}

/** 酿造台现在的样子:三个瓶位、材料、燃料轮数、在不在酿;右键看台与 brew 回执共用 */
export function brewStandText(
  bot: Bot, win: { id?: number; slots: Array<{ name: string; count: number } | null> },
): string {
  const bottles = BREW_BOTTLE_SLOTS.map((s) => win.slots[s] ?? null).filter((s) => s !== null);
  const fuelLeft = windowProp(bot, win, BREW_PROP_FUEL);
  const brewTicks = windowProp(bot, win, BREW_PROP_TIME);
  const fuelSlot = win.slots[BREW_FUEL_SLOT];
  const fuel = `燃料${fuelLeft === null ? '读数没收到' : `还能烧 ${fuelLeft}/20 轮`}`
    + (fuelSlot ? `(燃料位另有${itemCustomName(fuelSlot) ?? zhName(fuelSlot.name)}×${fuelSlot.count})` : '(燃料位空)');
  const brewing = brewTicks === null
    ? '酿造进度读数没收到'
    : brewTicks > 0 ? `正在酿,还剩约 ${Math.ceil(brewTicks / 20)} 秒` : '没在酿';
  const input = win.slots[BREW_INPUT_SLOT] ?? null;
  return `瓶位${bottles.length > 0 ? bottles.map((s) => potionText(s)).join('、') : '空'},`
    + `材料位${input ? potionText(input) : '空'},${fuel},${brewing}`;
}

/**
 * 右键开出来的窗口在关窗前记进容器账本,回执带上看见了什么。
 * 箱子族整窗记;炉子族记三槽位,有炉火和进度读数才估到期。不是容器就什么都不做。
 */
export function rememberWindow(
  bot: Bot,
  ctx: SkillContext,
  cell: Cell,
  blockName: string,
  win: NonNullable<Bot['currentWindow']>,
): string {
  const menu = selectionMenuTitle(win.title);
  if (menu) {
    if (CONTAINER_FIND.includes(blockName)) rememberNonStorageMenu(bot, cell);
    return `。打开的是${menu}选择菜单，不能当储物箱存东西`;
  }
  if (CONTAINER_FIND.includes(blockName)) {
    clearStorageMenu(bot, cell);
    const snap = rememberChest(ctx, bot, cell, win as Parameters<typeof containerStacks>[0]);
    return `。箱里:${contentsText(snap.items)}`;
  }
  if (FURNACE_KINDS.has(blockName)) {
    const state = { input: slotStack(win, 0), fuel: slotStack(win, 1), output: slotStack(win, 2) };
    const now = Date.now();
    const expected = furnaceDoneAt(win, state.input, blockName, now);
    ctx.chests?.rememberFurnace(dimensionOf(bot), cell, blockName, state, now, expected);
    const slot = (s: ItemStack | null): string => (s ? `${s.displayName ?? zhName(s.name)}×${s.count}` : '空');
    return `。炉里:输入${slot(state.input)},燃料${slot(state.fuel)},输出${slot(state.output)}`
      + `。装料点火用 smelt 的 input、fuel 和 at:[${cell.x},${cell.y},${cell.z}]；`
      + '手持材料右键是打开窗口，不是写入输入槽或燃料槽。'
      + `取货用 take 的 at:[${cell.x},${cell.y},${cell.z}]。烧炼是否启动以炉火与进度读数为准，产物以输出槽为准`;
  }
  if (blockName === 'brewing_stand') return `。台里:${brewStandText(bot, win as never)}`;
  return '';
}

export function orderForStow(
  found: Array<{ x: number; y: number; z: number; name: string; d: number }>,
  ctx: SkillContext,
  bot: Bot,
  item: string,
): typeof found {
  const dim = dimensionOf(bot);
  const nearWithRoom: typeof found = [];
  const nearUnseen: typeof found = [];
  const farWithRoom: typeof found = [];
  const farUnseen: typeof found = [];
  const full: typeof found = [];
  // 堆叠上限是物品自带的属性(原版:大多 64,鸡蛋/雪球 16,工具/桶 1),registry 里就有
  const stackMax = (bot.registry.itemsByName as Record<string, { stackSize?: number } | undefined>)
    ?.[item]?.stackSize ?? 64;
  for (const s of found) {
    if (storageSkipReason(bot, s, item)) continue;
    const rec = ctx.chests?.get(dim, s);
    if (rec && !hasRoom(rec, item, stackMax, bot?.registry)) full.push(s);
    else if (s.d <= 8) (rec ? nearWithRoom : nearUnseen).push(s);
    else (rec ? farWithRoom : farUnseen).push(s);
  }
  return [...nearWithRoom, ...nearUnseen, ...farWithRoom, ...farUnseen, ...full];
}

interface StorageObservation {
  menu?: { name: string | null; stateId: number | null };
  access?: { from: { x: number; y: number; z: number }; atMs: number; why: string };
  routeFail?: { atMs: number; why: string };
  write?: Map<string, { atMs: number; why: string }>;
}

/** Access failure is local to the failed stand position; another approach may work. */
export const STORAGE_ACCESS_RETRY_MS = 120_000;
export const STORAGE_ACCESS_RETRY_DISTANCE = 8;
export const AUTO_CONTAINER_OPEN_LIMIT = 3;
const storageObservations = new WeakMap<Bot, Map<string, StorageObservation>>();

function containerKey(bot: Bot, spot: { x: number; y: number; z: number }): string {
  return `${dimensionOf(bot)}:${spot.x},${spot.y},${spot.z}`;
}

function storageRecord(bot: Bot, spot: { x: number; y: number; z: number }): StorageObservation {
  let map = storageObservations.get(bot);
  if (!map) {
    map = new Map();
    storageObservations.set(bot, map);
  }
  const key = containerKey(bot, spot);
  let rec = map.get(key);
  if (!rec) {
    rec = {};
    map.set(key, rec);
  }
  return rec;
}

function blockIdentity(bot: Bot, spot: { x: number; y: number; z: number }): { name: string | null; stateId: number | null } {
  const block = bot.blockAt?.(new Vec3(spot.x, spot.y, spot.z));
  return { name: block?.name ?? null, stateId: block?.stateId ?? null };
}

export function storageSkipReason(bot: Bot, spot: { x: number; y: number; z: number }, item?: string): string | null {
  const rec = storageObservations.get(bot)?.get(containerKey(bot, spot));
  if (!rec) return null;
  if (rec.menu) {
    const current = blockIdentity(bot, spot);
    if ((rec.menu.name && current.name && rec.menu.name !== current.name)
      || (rec.menu.stateId !== null && current.stateId !== null && rec.menu.stateId !== current.stateId)) {
      rec.menu = undefined;
    } else return '上次打开的是选择菜单';
  }
  if (rec.access) {
    const pos = bot.entity.position;
    const moved = Math.hypot(pos.x - rec.access.from.x, pos.y - rec.access.from.y, pos.z - rec.access.from.z);
    if (Date.now() - rec.access.atMs < STORAGE_ACCESS_RETRY_MS && moved < STORAGE_ACCESS_RETRY_DISTANCE) {
      return `从当前站位上次没走到:${rec.access.why}`;
    }
    rec.access = undefined;
  }
  if (item) {
    const write = rec.write?.get(item);
    if (write && Date.now() - write.atMs < STORAGE_ACCESS_RETRY_MS) return `上次存${zhName(item)}被拒绝:${write.why}`;
    if (write) rec.write?.delete(item);
  }
  return null;
}

/** 直达一口刚刚寻路失败的箱子同样会重走失败路线；短暂冷却后再试。 */
export function recentStorageRouteFailure(bot: Bot, spot: { x: number; y: number; z: number }): string | null {
  const access = storageObservations.get(bot)?.get(containerKey(bot, spot))?.routeFail;
  if (!access || Date.now() - access.atMs >= STORAGE_ACCESS_RETRY_MS) return null;
  if (bot.entity.position.distanceTo(new Vec3(spot.x, spot.y, spot.z)) <= 4) return null;
  return access.why;
}

export function rememberNonStorageMenu(bot: Bot, spot: { x: number; y: number; z: number }): void {
  const rec = storageRecord(bot, spot);
  rec.menu = blockIdentity(bot, spot);
  rec.access = undefined;
}

export function clearStorageMenu(bot: Bot, spot: { x: number; y: number; z: number }): void {
  const rec = storageObservations.get(bot)?.get(containerKey(bot, spot));
  if (rec) rec.menu = undefined;
}

export function rememberStorageAccessFailure(bot: Bot, spot: { x: number; y: number; z: number }, why: string): void {
  const pos = bot.entity.position;
  const record = storageRecord(bot, spot);
  record.access = { from: { x: pos.x, y: pos.y, z: pos.z }, atMs: Date.now(), why: why.slice(0, 180) };
  record.routeFail = { atMs: Date.now(), why: why.slice(0, 180) };
}

export function rememberStorageWriteFailure(bot: Bot, spot: { x: number; y: number; z: number }, item: string, why: string): void {
  const rec = storageRecord(bot, spot);
  rec.write ??= new Map();
  rec.write.set(item, { atMs: Date.now(), why: why.slice(0, 180) });
}

export function clearStorageWriteFailure(bot: Bot, spot: { x: number; y: number; z: number }, item: string): void {
  storageObservations.get(bot)?.get(containerKey(bot, spot))?.write?.delete(item);
}

export function orderForTake(
  found: Array<{ x: number; y: number; z: number; name: string; d: number }>,
  ctx: SkillContext,
  bot: Bot,
  item: string,
): typeof found {
  const dim = dimensionOf(bot);
  const nearbyStocked: typeof found = [];
  const nearbyUnseen: typeof found = [];
  const fartherStocked: typeof found = [];
  const fartherUnseen: typeof found = [];
  const knownEmpty: typeof found = [];
  for (const s of found) {
    if (storageSkipReason(bot, s)) continue;
    const rec = ctx.chests?.get(dim, s);
    if (rec && hasItem(rec, item, bot?.registry)) (s.d <= 8 ? nearbyStocked : fartherStocked).push(s);
    else if (!rec) (s.d <= 8 ? nearbyUnseen : fartherUnseen).push(s);
    else knownEmpty.push(s);
  }
  return [...nearbyStocked, ...nearbyUnseen, ...fartherStocked, ...fartherUnseen, ...knownEmpty];
}

/** mineflayer 拿错窗口身份时抛的话:「Non-container window used as a container」一族 */
export function isWindowIdentityError(err: unknown): boolean {
  return err instanceof Error && / window used as a /i.test(err.message);
}

/**
 * 开容器前退役遗留窗口；返回窗口身份不符时关闭并重开一次，连续失败才受阻。
 * 此处校验窗口身份，窗口状态版本由 mineflayer-fixes 的 stateId 守卫处理。
 */
export async function openWindowGuarded<T>(bot: Bot, ctx: SkillContext, open: () => Promise<T>): Promise<T> {
  const cur = bot.currentWindow;
  if (cur) {
    ctx.diag?.write({
      lane: 'skill', event: 'stale-window-retire',
      msg: `开容器前发现还挂着窗口${cur.id}(${cur.type}),先关掉`,
      data: { windowId: cur.id, type: String(cur.type) },
    });
    bot.closeWindow(cur);
    await sleep(150);
  }
  try {
    return await open();
  } catch (err) {
    if (!isWindowIdentityError(err)) throw err;
    const w = bot.currentWindow;
    ctx.diag?.write({
      lane: 'skill', event: 'window-identity-retry',
      msg: `开出来的窗口身份不对(${w ? `窗口${w.id} ${w.type}` : '窗口已不在'}),强制关窗重开一次`,
      data: { windowId: w?.id, type: w ? String(w.type) : null },
    });
    if (w) bot.closeWindow(w);
    await sleep(300);
    try {
      return await open();
    } catch (err2) {
      if (!isWindowIdentityError(err2)) throw err2;
      throw new SkillBlocked(
        '窗口串号了:上一个界面窗口没退干净,这次开容器拿到的是错的窗口身份;' +
        '已强制关窗重试一次仍没成。东西都还在,没有丢——过几秒再开一次多半就好',
      );
    }
  }
}

export async function openNearbyContainer(
  bot: Bot,
  spot: { x: number; y: number; z: number; name: string },
  ctx: SkillContext,
): Promise<Awaited<ReturnType<Bot['openContainer']>>> {
  // 已够得到时直接开窗。近处强制寻路可能把人从箱边挪开甚至超时，
  // 令「先取大背包、再存箱」只做成前半步，反而重新塞满随身栏。
  await reachCell(bot, spot, ctx);
  const block = bot.blockAt(new Vec3(spot.x, spot.y, spot.z));
  if (!block) throw new SkillBlocked(`${zhName(spot.name)}不见了`);
  return openWindowGuarded(bot, ctx, () => bot.openContainer(block));
}

export interface GenericWindow {
  id?: number;
  type?: string;
  slots: Array<{ name: string; count: number; slot: number } | null>;
  items(): Array<{ name: string; count: number; slot: number }>;
  close(): void;
}

