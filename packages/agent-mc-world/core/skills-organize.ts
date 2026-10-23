import type { Bot } from 'mineflayer';
import type { SkillCall } from './skills.ts';
import { SkillBlocked, checkAbort, type SkillContext } from './skill-context.ts';
import { inventoryReadConfirmed } from './inventory-window-sync.ts';
import { clickInventoryConfirmed, inventoryClickState, isInventoryClickError } from './inventory-click-sync.ts';
import { itemPredOf, invCountIn, playerInvIn } from './inventory.ts';
import { skillStow, skillToss } from './skills-container.ts';
import { consumesOpenWindow, selectionMenuTitle } from './window-semantics.ts';
import { inventoryOrganizationKey, inventoryOrganizationLimit, inventoryOrganizationTotals, organizationSlotState,
  planInventoryOrganization, type OrganizationMove, type OrganizationStack } from './inventory-organization.ts';

type Call = Extract<SkillCall, { skill: 'organize' }>;
type Window = NonNullable<Bot['currentWindow']>;
const activeWindow = (bot: Bot): Window => bot.currentWindow ?? bot.inventory;
const cells = (win: Window) => win.slots as Array<OrganizationStack | null>;

function sameWindow(bot: Bot, win: Window, read = true): void {
  if (activeWindow(bot) !== win) throw new SkillBlocked('整理窗口已关闭或被替换，后续点击未发送', [], 'local', 'container-window-changed');
  if (read && !inventoryReadConfirmed(bot)) throw new SkillBlocked('槽位或光标尚未确认；先读取新状态，整理不会自动重放', [], 'server', 'inventory-click-sync');
}

function rangeOf(win: Window, call: Call): { start: number; end: number } {
  if ((call.target ?? 'inventory') === 'open') {
    if (win.id === 0 || win.inventoryStart <= 0) throw new SkillBlocked('整理当前容器须先打开真实储物窗口');
    const menu = selectionMenuTitle(win.title);
    if (menu) throw new SkillBlocked(`${menu}是选择菜单，图标不是储物物品`);
    if (!/generic_9x[1-6]|generic_3x3|hopper|shulker|chest|dispenser|dropper/i.test(String(win.type)))
      throw new SkillBlocked(`窗口类型 ${win.type} 未声明普通储物槽；工作站输入/输出格不能按仓库排序`);
    return { start: 0, end: win.inventoryStart };
  }
  const start = win.inventoryStart, end = win.inventoryEnd - (call.includeHotbar ? 0 : 9);
  if (start < 0 || end <= start) throw new SkillBlocked('未收到可整理的玩家背包槽位');
  return { start, end };
}

/** One confirmed pick/place/exchange; cancellation returns only the cursor this operation owns. */
async function performMove(bot: Bot, win: Window, move: OrganizationMove, ctx: SkillContext): Promise<void> {
  sameWindow(bot, win); checkAbort(ctx);
  const checkSlots = () => {
    sameWindow(bot, win); checkAbort(ctx);
    if (organizationSlotState(cells(win)[move.from]) !== move.source
      || organizationSlotState(cells(win)[move.to]) !== move.destination)
      throw new SkillBlocked('整理计划的源槽或目标槽已变化，剩余步骤未执行；先读取当前背包');
  };
  checkSlots();
  const source = cells(win)[move.from]!, destination = cells(win)[move.to];
  const picked = { ...source, componentMap: source.componentMap };
  const priorDestination = destination ? { ...destination, componentMap: destination.componentMap } : null;
  const merged = move.kind === 'merge' && priorDestination;
  const count = merged ? Math.min(picked.count, (inventoryOrganizationLimit(priorDestination) ?? 1) - priorDestination.count) : picked.count;
  const placed = merged ? { ...priorDestination, count: priorDestination.count + count } : picked;
  const carried = merged ? picked.count > count ? { ...picked, count: picked.count - count } : null : priorDestination;
  let owned: string | null = null;
  try {
    await clickInventoryConfirmed(bot, move.from, 0, 0, win, () => {
      sameWindow(bot, win, false); checkAbort(ctx);
      if (cells(win)[move.from] || organizationSlotState(win.selectedItem) !== move.source
        || organizationSlotState(cells(win)[move.to]) !== move.destination)
        throw new SkillBlocked('派发前源槽或目标槽已变化，整理点击未发送');
    });
    if (win.selectedItem) owned = organizationSlotState(win.selectedItem);
    checkAbort(ctx); sameWindow(bot, win);
    await clickInventoryConfirmed(bot, move.to, 0, 0, win, () => {
      sameWindow(bot, win, false); checkAbort(ctx);
      if (organizationSlotState(win.selectedItem) !== organizationSlotState(carried)
        || organizationSlotState(cells(win)[move.to]) !== organizationSlotState(placed))
        throw new SkillBlocked('整理期间目标槽或材料光标变化，停止本次交换');
    });
    owned = win.selectedItem ? organizationSlotState(win.selectedItem) : null;
  } finally {
    // Unknown acknowledgements never authorize a compensating click. Keep the cursor for recovery.
    if (owned && win.selectedItem && activeWindow(bot) === win && inventoryClickState(bot).phase === 'ready'
      && organizationSlotState(win.selectedItem) === owned) {
      const source = cells(win)[move.from], cursor = win.selectedItem as OrganizationStack;
      if (source && (inventoryOrganizationKey(source) !== inventoryOrganizationKey(cursor)
        || source.count + cursor.count > (inventoryOrganizationLimit(source) ?? 1)))
        throw new SkillBlocked('整理的返回槽已被其他物品占用，保留服务端光标；未继续交换');
      const returned = { ...cursor, componentMap: cursor.componentMap, count: (source?.count ?? 0) + cursor.count };
      await clickInventoryConfirmed(bot, move.from, 0, 0, win, () => {
        sameWindow(bot, win, false);
        if (win.selectedItem || organizationSlotState(cells(win)[move.from]) !== organizationSlotState(returned))
          throw new SkillBlocked('清理时材料或光标已变化，保留现场');
      });
    }
  }
  sameWindow(bot, win); checkAbort(ctx);
  if (win.selectedItem) throw new SkillBlocked('整理后光标仍持有物品，剩余动作未执行');
}

export async function skillOrganize(bot: Bot, call: Call, ctx: SkillContext): Promise<string> {
  checkAbort(ctx);
  const initial = activeWindow(bot);
  sameWindow(bot, initial);
  if (initial.selectedItem) throw new SkillBlocked('当前材料仍在光标上，先完成上一笔存取再整理');
  const initialRange = rangeOf(initial, call);
  const rules = call.rules ?? [];
  // Disposition is not permission to move unrelated stacks or server-owned shortcut items.
  // Preserve ordinary organize and explicit true/false arrangement semantics.
  const arrange = rules.length === 0 || call.sort !== undefined;
  const preview = arrange
    ? planInventoryOrganization(cells(initial), initialRange.start, initialRange.end, call.sort !== false)
    : { range: initialRange, beforeFree: cells(initial).slice(initialRange.start, initialRange.end).filter(x => !x).length,
      expectedFree: cells(initial).slice(initialRange.start, initialRange.end).filter(x => !x).length,
      merges: 0, swaps: 0, moves: [] };
  if ((call.target ?? 'inventory') === 'open' && rules.length) throw new SkillBlocked('取舍 rules 针对随身背包；target:open 只整理当前容器');
  if (call.dryRun) return JSON.stringify({ schema: 'minecraft-inventory-organization/v1', dryRun: true,
    target: call.target ?? 'inventory', includeHotbar: call.includeHotbar ?? false, plan: preview,
    rules: rules.map(rule => ({ ...rule, surplus: Math.max(0, invCountIn(playerInvIn(bot, initial),
      itemPredOf(bot, rule.item, rule.pick)) - rule.keep) })), boundary: '只读计划，未点击、存放或丢弃；执行重新读取当前槽位。' });

  const notes: string[] = [];
  // Rules are caller decisions, evaluated in order against fresh stock. The core has no junk whitelist.
  for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex++) {
    const rule = rules[ruleIndex];
    checkAbort(ctx);
    const win = activeWindow(bot); sameWindow(bot, win);
    const pred = itemPredOf(bot, rule.item, rule.pick), before = invCountIn(playerInvIn(bot, win), pred);
    const surplus = Math.max(0, before - rule.keep);
    if (surplus === 0) { notes.push(`${rule.item} 当前 ${before}，保留 ${rule.keep}；无需移出`); continue; }
    // Do not absorb future rules using stale counts: overlapping selectors have ordered semantics.
    // A retained open storage window is consumed by the next rule or the final arrangement phase.
    const steps: SkillCall[] = [{ skill: 'stow', item: rule.item, count: surplus }, { skill: 'organize' }];
    const childCtx: SkillContext = { ...ctx, holdWindow: undefined,
      batch: { index: 0, steps, absorb: () => {} } };
    try {
      const text = rule.action === 'stow'
        ? await skillStow(bot, { skill: 'stow', item: rule.item, count: surplus, pick: rule.pick,
          ...(call.at ? { at: call.at } : {}), ...(call.into ? { into: call.into } : {}) }, childCtx)
        : await (async () => {
          if (bot.currentWindow) { sameWindow(bot, bot.currentWindow); bot.closeWindow(bot.currentWindow); }
          return skillToss(bot, { skill: 'toss', item: rule.item, count: surplus, pick: rule.pick }, childCtx);
        })();
      notes.push(text);
      const after = invCountIn(playerInvIn(bot, activeWindow(bot)), pred);
      const expected = Math.min(before, rule.keep);
      if (after !== expected) throw new SkillBlocked(`${rule.item} 预期保留 ${expected}，实际 ${after}；取舍结果不符，后续动作未执行`);
    } catch (error) {
      ctx.diag?.write({ lane: 'skill', event: 'inventory-organize-partial', taskId: ctx.taskId,
        msg: '取舍步骤未完成，保留已发生的结果，不自动重复', data: { rule, notes, error: String(error) } });
      if (error instanceof SkillBlocked) throw new SkillBlocked(error.message, [...notes, ...error.scene], error.source, error.code);
      throw error;
    }
  }
  const win = activeWindow(bot); sameWindow(bot, win);
  if (win.selectedItem) throw new SkillBlocked('取舍后光标仍持有物品，整理未继续', notes);
  if (!arrange) {
    const next = ctx.batch?.steps[ctx.batch.index + 1];
    if (bot.currentWindow === win && !consumesOpenWindow(next)) bot.closeWindow(win);
    const result = '随身背包整理完成：仅执行指定取舍规则，未额外合堆或排序';
    ctx.diag?.write({ lane: 'skill', event: 'inventory-organize', taskId: ctx.taskId,
      msg: result, data: { target: 'inventory', rules: rules.length, merges: 0, swaps: 0, notes } });
    return [...notes, result].join('\n');
  }
  const range = rangeOf(win, call), plan = planInventoryOrganization(cells(win), range.start, range.end, call.sort !== false);
  const beforeTotals = inventoryOrganizationTotals(cells(win));
  const untouched = cells(win).map((stack, index) => index < range.start || index >= range.end ? organizationSlotState(stack) : null);
  let merges = 0, swaps = 0;
  if (bot.currentWindow === win) ctx.holdWindow?.(win);
  for (const move of plan.moves) {
    try { await performMove(bot, win, move, ctx); }
    catch (error) {
      const summary = `整理已确认合堆 ${merges} 次、换位 ${swaps} 次；剩余未执行，先核对槽位和光标`;
      ctx.diag?.write({ lane: 'skill', event: 'inventory-organize-partial', taskId: ctx.taskId,
        msg: summary, data: { merges, swaps, notes, error: String(error) } });
      if (isInventoryClickError(error)) throw new SkillBlocked((error as Error).message, [...notes, summary], 'server', 'inventory-click-sync');
      if (error instanceof SkillBlocked) throw new SkillBlocked(error.message, [...notes, summary, ...error.scene], error.source, error.code);
      throw error;
    }
    if (move.kind === 'merge') merges++; else swaps++;
    if (inventoryOrganizationTotals(cells(win)) !== beforeTotals)
      throw new SkillBlocked('整理期间物品总量或数据发生额外变化，后续点击停止；先核对当前背包', notes, 'server');
    if (untouched.some((state, index) => state !== null && state !== organizationSlotState(cells(win)[index])))
      throw new SkillBlocked('整理范围以外的槽位发生变化，后续点击停止；先核对当前窗口', notes, 'server');
  }
  const afterFree = cells(win).slice(range.start, range.end).filter(x => !x).length;
  const result = `${(call.target ?? 'inventory') === 'inventory' ? '随身背包' : '当前容器'}整理完成：合堆 ${merges} 次、换位 ${swaps} 次，空格 ${plan.beforeFree}→${afterFree}；物品数据和总量已核对`
    + ((call.target ?? 'inventory') === 'inventory' && !call.includeHotbar ? '；快捷栏保持原位' : '');
  ctx.diag?.write({ lane: 'skill', event: 'inventory-organize', taskId: ctx.taskId,
    msg: result, data: { target: call.target ?? 'inventory', merges, swaps, beforeFree: plan.beforeFree, afterFree, rules: rules.length, notes } });
  const next = ctx.batch?.steps[ctx.batch.index + 1];
  if (bot.currentWindow === win && !consumesOpenWindow(next)) bot.closeWindow(win);
  return [...notes, result].join('\n');
}
