/** 纯方块交互时，避免自定义右键物品抢走开门/开箱子的服务端动作。 */
import type { Bot } from 'mineflayer';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Aborted, SkillBlocked, sleep } from './skill-context.ts';
import { itemCustomName } from './item-display.ts';
import { CHEST_BLOCKS } from './chests.ts';
import { onConnectionEnd } from './connection-end.ts';

const MECHANISM = /(^|_)(?:door|trapdoor|fence_gate|button)$/;
const BED = /(^|_)bed$/;
const UTILITY = new Set([
  'lever', ...CHEST_BLOCKS,
  'furnace', 'blast_furnace', 'smoker', 'crafting_table',
  'anvil', 'chipped_anvil', 'damaged_anvil', 'grindstone',
  'loom', 'stonecutter', 'cartography_table', 'smithing_table',
  'enchanting_table', 'brewing_stand', 'lectern',
]);

const ORDINARY_TOOL = /_(?:sword|pickaxe|axe|shovel|hoe)$/;
const NAVIGATION_MECHANISM = /(^|_)(?:door|fence_gate)$/;
const NAVIGATION_CONFIRM_MS = 1200;
const preparedInteractionHand = new AsyncLocalStorage<Bot>();

/** 调用方负责准备主手并在发包时核验；此调用中的导航包装不再更换主手。 */
export function withPreparedInteractionHand<T>(bot: Bot, action: () => T): T {
  return preparedInteractionHand.run(bot, action);
}

export function needsBareHandToInteract(name: string, heldItemName?: string | null): boolean {
  // 剑、镐等普通工具可以直接按原版机制开门和按按钮。只对可能把右键
  // 截走的道具腾手；否则满包时连受保护区域的门都打不开。
  if (MECHANISM.test(name)) return !heldItemName || !ORDINARY_TOOL.test(heldItemName);
  // Beds also accept ordinary tools. A full bag must not turn the optional
  // empty-hand preparation into a blanket refusal to attempt sleep.
  return UTILITY.has(name) || BED.test(name);
}

/** 已知有空背包格才 unequip；不能让 Mineflayer 在满包时把主手物品扔掉。 */
export async function clearHandForBlockInteraction(bot: Bot, requireEmpty = false): Promise<boolean> {
  if (!bot.heldItem) return false;
  const slots = bot.inventory?.slots;
  const hasRoom = Array.isArray(slots)
    ? slots.slice(9, 45).some((item) => item == null)
    : typeof bot.inventory?.items === 'function' && bot.inventory.items().length < 36;
  if (!requireEmpty && !hasRoom && typeof bot.equip === 'function') {
    const plainTool = bot.inventory.items().find((item) => ORDINARY_TOOL.test(item.name) && !itemCustomName(item));
    if (plainTool) {
      await bot.equip(plainTool, 'hand');
      if (bot.heldItem?.name === plainTool.name) return false;
    }
  }
  if (!hasRoom || typeof bot.unequip !== 'function') {
    if (requireEmpty) {
      throw new SkillBlocked('需要空手右键目标方块，但背包没有空格或无法腾空主手；没有继续右键，先整理背包或切到空快捷栏', [], 'local', 'interaction-hand-unavailable');
    }
    throw new SkillBlocked('需要空手操作门或功能方块，但背包没有空格且找不到可安全右键的普通工具；先整理背包或切到空快捷栏', [], 'local', 'interaction-hand-unavailable');
  }
  await bot.unequip('hand');
  if (bot.heldItem) throw new SkillBlocked('尝试腾空主手后仍拿着物品；这次没有继续右键', [], 'local', 'interaction-hand-unavailable');
  return true;
}

interface NavigationInteractionFailure {
  sequence: number;
  goal: NonNullable<Bot['pathfinder']['goal']>;
  error: SkillBlocked;
}
const navigationHands = new WeakMap<Bot, {
  generation: number; sequence: number; closed: boolean; failure: NavigationInteractionFailure | null;
}>();

type InteractionBlock = Parameters<Bot['activateBlock']>[0];
type NavigationUseBot = Bot & {
  cortiNavigateUse?: (block: InteractionBlock | null, expectedOpen?: boolean) => Promise<void>;
};

function blockOpen(block: InteractionBlock | null): boolean | null {
  const value = block?.getProperties?.().open;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

function mechanismStateConfirmed(bot: Bot, block: InteractionBlock, open: boolean): boolean {
  if (blockOpen(block) !== open) return false;
  if (!block.name.endsWith('_door')) return true;
  const half = block.getProperties().half;
  if (half !== 'lower' && half !== 'upper') return false;
  const other = bot.blockAt(block.position.offset(0, half === 'lower' ? 1 : -1, 0));
  return other?.name === block.name && other.getProperties().half === (half === 'lower' ? 'upper' : 'lower')
    && blockOpen(other) === open;
}

/** Original interaction failure belonging to a particular path, never a world reachability verdict. */
export function navigationInteractionFailureOf(bot: Bot): NavigationInteractionFailure | null {
  return navigationHands.get(bot)?.failure ?? null;
}

/** 寻路器的 useOne 开门直接调用 bot.activateBlock，也须走同一条腾手规则。 */
export function installNavigationBareHand(bot: Bot): void {
  if (navigationHands.has(bot)) return;
  const state = { generation: 0, sequence: 0, closed: false, failure: null as NavigationInteractionFailure | null };
  navigationHands.set(bot, state);
  const invalidate = () => { state.generation++; };
  bot.on('goal_updated', invalidate);
  bot.on('path_reset', invalidate);
  onConnectionEnd(bot, () => {
    state.closed = true;
    bot.off('goal_updated', invalidate);
    bot.off('path_reset', invalidate);
    delete (bot as NavigationUseBot).cortiNavigateUse;
    navigationHands.delete(bot);
  });
  const original = bot.activateBlock.bind(bot);
  const activate = async (block: InteractionBlock | null, direction?: Parameters<Bot['activateBlock']>[1],
    cursorPos?: Parameters<Bot['activateBlock']>[2], expectedOpen?: boolean): Promise<void> => {
    if (preparedInteractionHand.getStore() === bot
      || (expectedOpen === undefined && (!block || !NAVIGATION_MECHANISM.test(block.name)))) {
      return original(block as InteractionBlock, direction, cursorPos);
    }
    const goal = bot.pathfinder?.isBuilding?.() ? bot.pathfinder.goal : null;
    const generation = state.generation;
    const stillOwnsPath = () => !state.closed && goal !== null && goal !== undefined
      && state.generation === generation && bot.pathfinder?.goal === goal;
    try {
      if (!block || !NAVIGATION_MECHANISM.test(block.name)) {
        throw new SkillBlocked('寻路交互位置的门已变化或未加载，先重新观察通路', [], 'local', 'route-obstructed');
      }
      if (expectedOpen !== undefined && !stillOwnsPath()) throw new Aborted('原寻路已结束，未继续右键');
      const readMechanism = () => {
        const current = bot.blockAt(block.position);
        if (current?.name !== block.name || blockOpen(current) === null) {
          throw new SkillBlocked(`门 ${block.position} 已变化或状态未同步，先重新观察通路`, [], 'local', 'route-obstructed');
        }
        return current;
      };
      if (expectedOpen !== undefined) {
        let current = readMechanism();
        if (blockOpen(current) !== expectedOpen) {
          if (needsBareHandToInteract(block.name, bot.heldItem?.name)) await clearHandForBlockInteraction(bot);
          if (!stillOwnsPath()) throw new Aborted('原寻路已结束，未继续右键');
          current = readMechanism();
          if (blockOpen(current) !== expectedOpen) await original(current, direction, cursorPos);
        }
        const deadline = Date.now() + NAVIGATION_CONFIRM_MS;
        while (stillOwnsPath()) {
          if (mechanismStateConfirmed(bot, readMechanism(), expectedOpen)) return;
          if (Date.now() >= deadline) {
            throw new SkillBlocked(`门 ${block.position} 未确认${expectedOpen ? '打开' : '关闭'}，本段已停止；核对门或选择其他通路`,
              [], 'local', 'route-obstructed');
          }
          await sleep(50);
        }
        throw new Aborted('原寻路已结束，未继续走门');
      }
      if (needsBareHandToInteract(block.name, bot.heldItem?.name)) await clearHandForBlockInteraction(bot);
      if (goal && !stillOwnsPath()) throw new Aborted('原寻路已结束，未继续右键');
      return await original(block, direction, cursorPos);
    } catch (error) {
      if (goal && stillOwnsPath()) {
        // Upstream useOne only logs/retries rejection and leaves `placing`
        // true. Stop this exact path once, before it can retry every tick;
        // gotoGoal reads the original cause instead of a later stall timeout.
        state.failure = { sequence: ++state.sequence, goal, error: error instanceof SkillBlocked
          ? error : new SkillBlocked(`寻路开门失败: ${error instanceof Error ? error.message : String(error)}`) };
        bot.pathfinder.setGoal(null);
      }
      throw error;
    }
  };
  bot.activateBlock = (block, direction, cursorPos) => activate(block, direction, cursorPos);
  (bot as NavigationUseBot).cortiNavigateUse = (block, expectedOpen) => activate(block, undefined, undefined, expectedOpen);
}
