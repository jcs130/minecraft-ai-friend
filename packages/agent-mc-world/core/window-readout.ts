import { serverScreen, renderScreen, type ServerScreen } from './server-screens.ts';
import { itemCustomName, itemLoreText } from './item-display.ts';
import { minecraftTextComponent } from './text-component.ts';
import { serverWindows } from './orphan-windows.ts';

export interface WindowSlotReadout {
  slot: number;
  id: string;
  count: number;
  name: string | null;
  lore: string[];
}

export interface WindowReadout {
  schema: 'agent-mc/window-read/v1';
  open: boolean;
  /** tracked = mineflayer window (readable and clickable); server-only = server has it open but no contents are modelled. */
  state: 'none' | 'tracked' | 'server-only';
  windowId: number | null;
  title: string | null;
  containerSlots: number | null;
  slots: WindowSlotReadout[];
  adopted: boolean;
  /** Non-container screen the server opened (dialog/book/death), if any. */
  screen?: ServerScreen | null;
}

type SlotItem = { name?: string; count?: number; customName?: unknown; componentMap?: Map<string, { data?: unknown }>;
  components?: Array<{ type?: string; data?: unknown }>; nbt?: unknown } | null | undefined;

/** Read-only view of the open non-player window: every container slot with name and lore. */
export function readOpenWindow(bot: any, options: { loreLines?: number } = {}): WindowReadout {
  const loreLines = options.loreLines ?? 12;
  const tracked = serverWindows(bot)?.current() ?? null;
  const win = bot?.currentWindow && bot.currentWindow.id !== 0 ? bot.currentWindow : null;
  if (!win) {
    return { schema: 'agent-mc/window-read/v1', open: !!tracked, state: tracked ? 'server-only' : 'none',
      windowId: tracked?.id ?? null, title: tracked ? minecraftTextComponent(tracked.title) || null : null,
      containerSlots: tracked?.itemCount != null ? tracked.itemCount - 36 : null, slots: [], adopted: false,
      screen: serverScreen(bot) };
  }
  const end = Number.isInteger(win.inventoryStart) && win.inventoryStart > 0 ? win.inventoryStart : (win.slots?.length ?? 0);
  const slots: WindowSlotReadout[] = [];
  for (let i = 0; i < end; i++) {
    const item = win.slots?.[i] as SlotItem;
    if (!item || !item.name || item.name === 'air') continue;
    slots.push({ slot: i, id: item.name, count: item.count ?? 1, name: itemCustomName(item),
      lore: itemLoreText(item).slice(0, loreLines) });
  }
  return { schema: 'agent-mc/window-read/v1', open: true, state: 'tracked', windowId: win.id ?? null,
    title: minecraftTextComponent(win.title) || null, containerSlots: end, slots,
    adopted: tracked && tracked.id === win.id ? tracked.adopted : false, screen: serverScreen(bot) };
}

export function renderWindowReadout(r: WindowReadout, maxChars = 6000): string {
  if (r.state === 'none' && r.screen) {
    return renderScreen(r.screen) + (r.screen.kind === 'dialog'
      ? '\n点按钮用 {"skill":"menu_click","slot":按钮序号} 或 {"skill":"menu_click","name":"按钮文字"}；关闭用 {"skill":"menu_close"}。对话框开着时服务端会拒绝指令。'
      : r.screen.kind === 'book' ? '\n合上用 {"skill":"menu_close"}。' : '');
  }
  if (r.state === 'none') return '[窗口] 当前没有打开的服务端窗口/菜单。';
  if (r.state === 'server-only') {
    return `[窗口] 服务端认为窗口 #${r.windowId}${r.title ? `「${r.title}」` : ''} 仍开着，但客户端没有它的格子内容；`
      + '此时服务端会拒绝指令（如「打开界面时无法执行指令」）。用 menu_close 步骤关掉它再继续。';
  }
  const head = `[窗口] #${r.windowId}「${r.title ?? '无标题'}」${r.adopted ? '（插件菜单，已补建可点）' : ''}；容器 ${r.containerSlots} 格，`
    + `非空 ${r.slots.length} 格。点选用 {"skill":"menu_click","slot":N}；用完用 {"skill":"menu_close"}。只读，未点击任何格子。`;
  const lines: string[] = [head];
  let used = head.length;
  const filler = r.slots.filter((s) => !s.name && !s.lore.length && /glass_pane$/.test(s.id)).length;
  if (filler) lines.push(`（${filler} 格无名玻璃板装饰已省略）`);
  for (const s of r.slots) {
    if (!s.name && !s.lore.length && /glass_pane$/.test(s.id)) continue;
    const line = `#${s.slot} ${s.name ?? s.id}${s.name ? `（${s.id}` : '（'}×${s.count}）${s.lore.length ? '：' + s.lore.join(' / ') : ''}`;
    if (used + line.length + 1 > maxChars) { lines.push(`…其余 ${r.slots.length - lines.length + 1} 格省略`); break; }
    lines.push(line); used += line.length + 1;
  }
  return lines.join('\n');
}

/** Clicks that could spend currency, buy, sell or trade are refused by policy. */
const SPEND = /点券|充值|购买|买入|出售|卖出|售出|交易|支付|付费|花费\s*[1-9]|消耗\s*[1-9]\d*\s*(?:游戏币|金币|点券|元)|价格\s*[:：]?\s*[1-9]|¥|￥/;

export function spendingRisk(slot: WindowSlotReadout | undefined): string | null {
  if (!slot) return null;
  const text = [slot.name ?? '', ...slot.lore].join('\n');
  const m = SPEND.exec(text);
  return m ? m[0] : null;
}
