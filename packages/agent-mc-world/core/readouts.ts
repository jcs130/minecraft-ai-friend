/**
 * 三份只读读数的渲染:背包、队列、上次没成的几条。
 *
 * 全是**现读现报**,一个字都不改世界、不动队列。放在这里而不是 world.ts 里,是因为
 * 这三份的输入都是纯数据(快照 / 队列状态 / 受阻账),单测直接喂结构就能跑。
 *
 * 措辞与别处同一份来源:背包清单走 `narrateInventory`,队列走 `renderQueue` ——
 * 同一件事两处措辞不同,读起来就像两件事(README「一件事只说一遍」)。
 */
import type { QueueStatus, BlockedRecord } from './executor.ts';
import { matchItemName, type ChestRecord, type NameRegistry } from './chests.ts';
import { renderQueue } from './executor.ts';
import type { GearPiece, GearSlot, ItemStack, WorldSnapshot } from './terrain.ts';
import { enchantSuffix, narrateCursor, narrateInventory } from './terrain.ts';
import { zhName } from './names.ts';
import { PLAYER_SLOTS } from './precheck.ts';

const GEAR_SLOT_ZH: Record<GearSlot, string> = {
  head: '头', chest: '胸', legs: '腿', feet: '脚', offhand: '副手',
};
const WORN_ORDER: readonly GearSlot[] = ['head', 'chest', 'legs', 'feet'];

function gearPhrase(p: GearPiece): string {
  const dura = p.durability ? ` ${p.durability.left}/${p.durability.max}` : '';
  return `${GEAR_SLOT_ZH[p.slot]}${p.displayName ?? zhName(p.name)}${enchantSuffix(p.enchantments)}${dura}`;
}

/**
 * 背包快照包括槽位占用、物品总量、手持和装备。
 * 首次服务端同步前报告未同步，避免将初始空视图当成空背包。
 */
export function renderBagReadout(s: WorldSnapshot): string {
  if (!s.invSynced) return '[背包] 物品栏还在从服务器同步,这份清单还没到。';
  const used = s.inventory.length;
  const held = s.heldItem ? `手里拿着${s.heldItemDisplayName ?? zhName(s.heldItem)}` : '手里空着';
  const worn = WORN_ORDER
    .map((slot) => s.equipment.find((p) => p.slot === slot))
    .filter((p): p is GearPiece => p !== undefined);
  const off = s.equipment.find((p) => p.slot === 'offhand');
  const lines = [
    `[背包] ${used}/${PLAYER_SLOTS} 格占着,空 ${PLAYER_SLOTS - used} 格。`,
    used > 0 ? `包里:${narrateInventory(s.inventory)}。\n工具物品名:${[...new Set(s.inventory.map((i) => i.name))].join('、')}。` : '包里什么都没有。',
    `${held}。`,
    narrateCursor(s),
    worn.length > 0 ? `穿着:${worn.map(gearPhrase).join('、')}。` : '身上没穿护甲。',
  ];
  lines.push(off ? `${gearPhrase(off)}。` : '副手空着。');
  return lines.join('\n');
}

/** Focused stock lookup: current carried items and last observed container contents stay separate. */
export function renderStoredItemReadout(
  s: WorldSnapshot,
  records: readonly ChestRecord[],
  query: string,
  openWindow?: { title: string; items: readonly ItemStack[] } | null,
  registry?: NameRegistry | null,
): string {
  if (!s.invSynced) return '[物资查询] 物品栏还在从服务器同步。';
  const item = query.trim().toLowerCase().replace(/^minecraft:/, '');
  if (!/^[^\p{Cc}\p{Cf}]{1,64}$/u.test(item)) return '[物资查询] 物品名格式不对。';
  const normalize = (name: string) => name.trim().toLowerCase().replace(/\s+/gu, ' ');
  const displayMatch = (stack: ItemStack) => stack.displayName !== undefined
    && normalize(stack.displayName) === normalize(item);
  const matches = (stack: ItemStack) => matchItemName(item, stack.name, registry)
    || zhName(stack.name) === item || displayMatch(stack);
  const carriedStacks: ItemStack[] = [...s.inventory,
    ...s.equipment.map((piece) => ({ ...piece, count: piece.count ?? 1, durability: piece.durability ?? undefined }))];
  const carried = carriedStacks.filter(matches)
    .reduce((total, stack) => total + stack.count, 0);
  const cursor = s.cursorItem && matches(s.cursorItem) ? narrateCursor(s) : '';
  const label = zhName(item);
  const currentWindow = openWindow
    ? `当前打开的「${openWindow.title}」里${label}×${openWindow.items.filter(matches)
      .reduce((total, stack) => total + stack.count, 0)}（现读）；`
    : '虚拟大背包等未开窗容器未计入；';
  const ids = [...new Set([...carriedStacks, ...(s.cursorItem ? [s.cursorItem] : []), ...(openWindow?.items ?? [])]
    .filter(displayMatch).map((stack) => stack.name))];
  const names = ids.length ? `当前匹配名称的工具物品名:${ids.join('、')}。` : '';
  const found = records.flatMap((record) => {
    const count = record.items.filter(matches)
      .reduce((total, stack) => total + stack.count, 0);
    return count > 0 ? [{ record, count }] : [];
  }).sort((a, b) => (b.record.observedAt ?? 0) - (a.record.observedAt ?? 0)
    || Math.hypot(a.record.x - s.position.x, a.record.y - s.position.y, a.record.z - s.position.z)
       - Math.hypot(b.record.x - s.position.x, b.record.y - s.position.y, b.record.z - s.position.z));
  const locations = found.slice(0, 3).map(({ record, count }) => {
    const when = record.observedAt
      ? new Date(record.observedAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
      : '旧档无时间';
    return `(${record.x},${record.y},${record.z}) 上次见到×${count}（${when}）`;
  });
  return `[物资查询] 随身${label}×${carried}。${names}${cursor}${currentWindow}${locations.length
    ? `本维度容器历史记录：${locations.join('；')}。到场开窗重查后再取；这些不是随身数量。`
    : `本维度容器账本没记到${label}；不等于其他容器里没有。`}`;
}

/** 背包接近满时，把容器账本中的槽位读数和距离带给收纳决策。 */
export function renderStorageReadout(s: WorldSnapshot, records: readonly ChestRecord[]): string | null {
  if (!s.invSynced || s.inventory.length < PLAYER_SLOTS - 12 || records.length === 0) return null;
  const ordered = [...records].sort((a, b) =>
    Math.hypot(a.x - s.position.x, a.y - s.position.y, a.z - s.position.z)
    - Math.hypot(b.x - s.position.x, b.y - s.position.y, b.z - s.position.z));
  const nearest = ordered.slice(0, 2);
  const withSpace = ordered.find((r) => r.usedSlots < r.slots);
  const nearbyWithSpace = ordered.find((r) => r.usedSlots < r.slots
    && Math.hypot(r.x - s.position.x, r.y - s.position.y, r.z - s.position.z) <= 16);
  if (withSpace && !nearest.includes(withSpace)) nearest.push(withSpace);
  const count = records.filter((r) => r.usedSlots >= r.slots).length;
  const shown = nearest.map((r) => {
    const distance = Math.round(Math.hypot(r.x - s.position.x, r.y - s.position.y, r.z - s.position.z));
    return `(${r.x},${r.y},${r.z}) ${r.usedSlots}/${r.slots} 格,直线 ${distance} 格`;
  }).join('；');
  const free = PLAYER_SLOTS - s.inventory.length;
  const merge = free <= 2 ? ordered
    .filter((r) => r.slots > 0 && r.usedSlots >= r.slots
      && Math.hypot(r.x - s.position.x, r.y - s.position.y, r.z - s.position.z) <= 8)
    .flatMap((r) => s.inventory.flatMap((held) => {
      // 只建议常规可堆叠物品；物品组件未保存在仓储摘要里，最终仍须以开窗回执核对。
      if (held.count <= 1 || held.enchantments?.length || held.displayName) return [];
      const match = r.items.find((stored) => stored.name === held.name
        && stored.count > 0 && stored.count < 64 && !stored.enchantments?.length && !stored.displayName);
      return match ? [{ r, held }] : [];
    }))[0] : undefined;
  const rescue = merge
    ? ` [收纳事务] 随身只余 ${free} 格。满箱也可能并堆：可先试把${zhName(merge.held.name)}×${merge.held.count}存进` +
      `(${merge.r.x},${merge.r.y},${merge.r.z})，开窗确认净减少后再继续；不要拿弓、盔甲等不可堆叠装备撞满箱。`
    : free <= 2 && !nearbyWithSpace
      ? ` [收纳事务] 随身只余 ${free} 格，附近已知箱子没有可确认的空位或并堆目标。可制作新箱；若手边没有材料或通往其他仓库的路线已失败，暂缓清空随身容器，保留其中物品，改做不依赖空栏的事。不要为收纳反复走已失败的路线。`
      : '';
  return `[仓储账] 本维度记过 ${records.length} 口容器,上次占满 ${count} 口；${shown}。槽位是上次开窗读数,到场需重查。${rescue}`;
}

/** 背包读数的指纹:一轮一答闸按它判「这一份读数变没变」(见 round.ts) */
export function bagStamp(s: WorldSnapshot | null): string {
  if (!s) return 'nobot';
  if (!s.invSynced) return 'nosync';
  return [
    s.inventory.length,
    [...s.inventory].map((i) => `${i.name}:${i.displayName ?? ''}${enchantSuffix(i.enchantments)}`
      + `${i.durability ? `:${i.durability.left}/${i.durability.max}` : ''}×${i.count}`).sort().join(','),
    `${s.heldItem ?? 'bare'}:${s.heldItemDisplayName ?? ''}`,
    narrateCursor(s),
    [...s.equipment].map((p) => `${p.slot}:${p.name}:${p.displayName ?? ''}`).sort().join(','),
  ].join('|');
}

/**
 * 队列现状:在做的那件与它跑到第几步、排队的、最近一单的终态。
 *
 * 最近一单的终态是这份读数里唯一"过去时"的东西 —— 它正是「我刚才那一单到底怎么了」
 * 这个问题的答案,而那条终态回执早被交接或后续事件挤出上下文了。
 */
export function renderQueueReadout(
  q: QueueStatus,
  last: { at: string; kind: string; text: string } | null,
): string {
  return [`[队列] ${renderQueue(q)}`, renderLastTaskReadout(last)].join('\n');
}

/** 只搬运已有执行终态；当前请求事实和按需队列查询使用同一份原文。 */
export function renderLastTaskReadout(last: { at: string; kind: string; text: string } | null): string {
  return last ? `[最近一单] ${last.at} ${last.text}` : '[最近一单] 这一场还没有跑完过任何一单。';
}

/** 队列读数的指纹。**不含时钟** —— 已跑多少秒每次都在变,进了指纹这道闸等于不存在 */
export function queueStamp(q: QueueStatus, lastAt: number | null): string {
  const r = q.running;
  return [
    r ? `${r.id}:${r.stepIndex}/${r.stepCount}:${r.count ? `${r.count.done}/${r.count.total}` : '-'}` : 'idle',
    q.waiting.map((w) => w.id).join(','),
    q.hold ?? '-',
    lastAt ?? '-',
  ].join('|');
}

/**
 * 最近几条没做成的记录:时刻、任务、步、原文原因。
 *
 * 只搬账本上已有的字,一个字不改写、不归因、不给建议(worlds-report-facts)。
 * 「同一类撞了几次」那件事另有头条在终态回执里报,这里不重复。
 */
export function renderBlockedReadout(records: readonly BlockedRecord[], clock: (ms: number) => string): string {
  if (records.length === 0) return '[上次没成] 这一场还没有记到受阻的步。';
  const lines = records.map((r) => `${clock(r.at)} ${r.task}${r.step ? ` ${r.step}` : ''}:${r.why}`);
  return `[上次没成] 最近 ${records.length} 条(新的在前):\n${lines.join('\n')}`;
}

/** 受阻读数的指纹:最新那一条的时刻 + 条数,两者都没动就是同一份读数 */
export function blockedStamp(records: readonly BlockedRecord[]): string {
  return `${records.length}|${records[0]?.at ?? '-'}`;
}
