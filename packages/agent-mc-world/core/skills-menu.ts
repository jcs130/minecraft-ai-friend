import type { Bot } from 'mineflayer';
import type { SkillCall } from './skills.ts';
import { SkillBlocked, checkAbort, sleep, type SkillContext } from './skill-context.ts';
import { readOpenWindow, spendingRisk } from './window-readout.ts';
import { serverWindows } from './orphan-windows.ts';
import { minecraftTextComponent } from './text-component.ts';
import { serverScreen, closeLocalScreen, type ScreenButton } from './server-screens.ts';
import { writeCustomClickLengthPrefixed } from './custom-click-action.mjs';

const DIALOG_RISK = /点券|充值|购买|买入|出售|卖出|售出|交易|支付|付费|花费|消耗|价格|¥|￥|\/(pay|buy|sell|trade|market|ah|auction|mijing)\b/i;

/** Perform one dialog button the way the vanilla client does. */
function performDialogButton(bot: Bot, b: ScreenButton): string {
  const client = (bot as unknown as { _client: any })._client;
  const a = b.action;
  if (!a) return `按钮「${b.label}」没有动作，仅关闭对话框`;
  const risk = DIALOG_RISK.exec(`${b.label} ${b.tooltip ?? ''} ${a.command ?? ''}`);
  if (risk) throw new SkillBlocked(`拒绝点对话框按钮「${b.label}」：含「${risk[0]}」，可能花费或交易；按规则不点`);
  if (a.type === 'run_command' || a.type === 'suggest_command') {
    if (!a.command) throw new SkillBlocked(`按钮「${b.label}」没有指令文本`);
    if (a.type === 'suggest_command') return `按钮「${b.label}」只是把「${a.command}」填进聊天框，未发送`;
    const cmd = a.command.replace(/^\//, '');
    bot.chat('/' + cmd);
    return `点了对话框按钮「${b.label}」→ 发送 /${cmd.split(/\s+/)[0]}`;
  }
  if (a.type === 'custom' || a.type === 'dynamic/custom') {
    if (!a.id) throw new SkillBlocked(`按钮「${b.label}」缺少动作 id`);
    writeCustomClickLengthPrefixed(client, a.id, { type: 'compound', name: '', value: {} });
    return `点了对话框按钮「${b.label}」→ 自定义动作 ${a.id}`;
  }
  if (a.type === 'open_url' || a.type === 'copy_to_clipboard' || a.type === 'show_dialog' || a.type === 'change_page')
    return `按钮「${b.label}」是本地动作（${a.type}），对服务端无效果`;
  throw new SkillBlocked(`对话框按钮「${b.label}」的动作类型 ${a.type} 暂不支持`);
}

async function dialogClick(bot: Bot, call: MenuClick, ctx: SkillContext): Promise<string> {
  const screen = serverScreen(bot)!;
  const want = call.name?.trim();
  const idx = typeof call.slot === 'number' && call.slot >= 0 ? call.slot : undefined;
  const hits = idx !== undefined ? screen.buttons.filter((b) => b.index === idx)
    : want ? screen.buttons.filter((b) => b.label.includes(want)) : [];
  if (hits.length !== 1) throw new SkillBlocked(hits.length ? `「${want}」匹配多个按钮，改用 slot=按钮序号`
    : `对话框「${screen.title}」没有这个按钮；按钮：${screen.buttons.map((b) => `#${b.index}「${b.label}」`).join('、') || '无'}`);
  checkAbort(ctx);
  const done = performDialogButton(bot, hits[0]);
  const until = Date.now() + 1_500;
  while (Date.now() < until && serverScreen(bot) === screen) { checkAbort(ctx); await sleep(100); }
  const after = serverScreen(bot);
  return `${done}；${after === screen ? '对话框仍显示（服务端未清除）' : after ? `出现新界面「${after.title}」（用 mc_window 读）` : '对话框已关闭'}`;
}


type MenuClick = Extract<SkillCall, { skill: 'menu_click' }>;

const posText = (bot: Bot): string => {
  const p = bot.entity?.position;
  return p ? `(${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)})` : '(未知)';
};

/** Click one slot of the open plugin menu. Never clicks player-inventory slots or spending options. */
export async function skillMenuClick(bot: Bot, call: MenuClick, ctx: SkillContext): Promise<string> {
  if (serverScreen(bot)?.kind === 'dialog' && !bot.currentWindow) return dialogClick(bot, call, ctx);
  const before = readOpenWindow(bot);
  if (before.state === 'none') throw new SkillBlocked('当前没有打开的服务端菜单；先发对应指令（如 /rtp、/linggen）再用 mc_window 读格子');
  if (before.state === 'server-only') {
    throw new SkillBlocked(`服务端菜单 #${before.windowId} 没有可读格子，不能盲点；先 menu_close 再重新打开`);
  }
  const slot = typeof call.slot === 'number' && call.slot >= 0 ? call.slot : undefined;
  let target = slot !== undefined ? before.slots.find((s) => s.slot === slot) : undefined;
  if (slot === undefined && call.name) {
    const want = call.name.trim();
    const hits = before.slots.filter((s) => (s.name ?? '').includes(want) || s.lore.some((l) => l.includes(want)));
    if (hits.length !== 1) {
      throw new SkillBlocked(hits.length ? `名称「${want}」匹配 ${hits.length} 格（${hits.map((h) => '#' + h.slot).join('、')}），改用 slot 指定`
        : `菜单里没有名称或说明含「${want}」的格子；先 mc_window 读格子`);
    }
    target = hits[0];
  }
  if (!target) {
    throw new SkillBlocked(slot !== undefined
      ? `菜单 #${before.windowId} 的第 ${slot} 格是空的或不在菜单区（菜单区 0-${(before.containerSlots ?? 1) - 1}）`
      : 'menu_click 需要 slot 或 name');
  }
  const risk = spendingRisk(target);
  if (risk) {
    throw new SkillBlocked(`拒绝点击 #${target.slot}「${target.name ?? target.id}」：说明含「${risk}」，可能花费点券/游戏币或交易；按规则不点`);
  }
  checkAbort(ctx);
  const win = bot.currentWindow!;
  const pos0 = bot.entity?.position?.clone?.();
  await bot.clickWindow(target.slot, call.button === 'right' ? 1 : 0, 0);
  // Plugin menus answer by reopening, closing, teleporting or messaging.
  const until = Date.now() + 2_500;
  while (Date.now() < until && bot.currentWindow === win) { checkAbort(ctx); await sleep(100); }
  const after = readOpenWindow(bot);
  const moved = pos0 && bot.entity?.position ? pos0.distanceTo(bot.entity.position) : 0;
  const windowText = after.state === 'none' ? '菜单已关闭'
    : after.windowId !== before.windowId || after.title !== before.title
      ? `打开了新菜单 #${after.windowId}「${after.title ?? ''}」（用 mc_window 读）` : '菜单仍开着（内容可能已刷新，用 mc_window 复读）';
  return `点了菜单 #${before.windowId}「${before.title ?? ''}」第 ${target.slot} 格「${target.name ?? target.id}」；${windowText}；`
    + `${moved > 4 ? `位置已变到 ${posText(bot)}（移动 ${moved.toFixed(0)} 格）` : `位置 ${posText(bot)}`}。效果以服务端消息为准`;
}

export function skillMenuClose(bot: Bot): string {
  const screen = serverScreen(bot);
  if (screen && !bot.currentWindow && !serverWindows(bot)?.current()) {
    if (screen.kind === 'dialog') {
      // Vanilla Escape: only when the dialog allows it; runs its exit action if it has one.
      if (screen.canCloseWithEscape === false) throw new SkillBlocked(`对话框「${screen.title}」不允许直接关闭；用 menu_click 选一个按钮`);
      const exit = screen.exitAction;
      const note = exit?.action ? performDialogButton(bot, exit) : '对话框无关闭动作';
      closeLocalScreen(bot, ['dialog']);
      return `已关闭对话框「${screen.title}」（${note}）`;
    }
    if (screen.kind === 'book') { closeLocalScreen(bot, ['book']); return '已合上书本'; }
    if (screen.kind === 'death') throw new SkillBlocked('死亡界面要等重生，不能关闭');
  }
  const tracked = serverWindows(bot);
  const title = bot.currentWindow ? minecraftTextComponent(bot.currentWindow.title) : null;
  const id = tracked ? tracked.close() : (bot.currentWindow ? (bot.closeWindow(bot.currentWindow), bot.currentWindow?.id ?? null) : null);
  if (id === null) {
    // Nothing tracked, but the server may still think a menu is open ("打开界面时无法执行指令").
    // Vanilla Escape sends close_window; the server closes its open menu whatever the id.
    const esc = tracked?.escape();
    return esc === undefined ? '没有打开的服务端菜单，无需关闭'
      : `客户端没跟踪到打开的菜单；已按 Esc 向服务端发送关闭（窗口 #${esc}），服务端若认为有界面开着会就此关掉`;
  }
  return `已关闭菜单 #${id}${title ? `「${title}」` : ''}`;
}

/** Vanilla swap-hands key (F): with both hands empty, many servers open their main menu. */
export async function skillSwapHands(bot: Bot, ctx: SkillContext): Promise<string> {
  const before = bot.currentWindow;
  const client = (bot as unknown as { _client: { write(name: string, p: unknown): void } })._client;
  const packet: Record<string, unknown> = { status: 6, location: { x: 0, y: 0, z: 0 }, face: 0 };
  // 1.19+ player_action carries a sequence; swap-hands does not acknowledge it.
  packet.sequence = 0;
  client.write('block_dig', packet);
  const until = Date.now() + 1_500;
  while (Date.now() < until && bot.currentWindow === before) { checkAbort(ctx); await sleep(100); }
  const opened = bot.currentWindow !== before && bot.currentWindow
    ? `；服务端打开了菜单「${minecraftTextComponent(bot.currentWindow.title)}」（用 mc_window 读）` : '';
  return `按了交换主副手键（F）${opened}`;
}
