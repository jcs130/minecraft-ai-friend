import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { installServerScreens, parseDialog, serverScreen, renderScreen, onServerScreen } from '../core/server-screens.ts';
import { skillMenuClick, skillMenuClose } from '../core/skills-menu.ts';
import { readOpenWindow, renderWindowReadout } from '../core/window-readout.ts';
import { viewerServerScreen } from '../core/viewer-server-screen.ts';

const s = (v: string) => ({ type: 'string', value: v });
function nbtDialog(extra: Record<string, unknown> = {}) {
  return { dialog: { type: 'compound', name: '', value: {
    type: s('minecraft:multi_action'),
    title: s('修仙统计'),
    body: { type: 'compound', value: { type: s('minecraft:plain_message'), contents: s('境界：凡人') } },
    actions: { type: 'list', value: { type: 'compound', value: [
      { label: s('查看灵根'), action: { type: 'compound', value: { type: s('minecraft:run_command'), command: s('/linggen') } } },
      { label: s('充值点券'), action: { type: 'compound', value: { type: s('minecraft:run_command'), command: s('/pay') } } },
      { label: s('关闭'), action: { type: 'compound', value: { type: s('minecraft:dynamic/custom'), id: s('xiuxian:close') } } },
    ] } },
    ...extra,
  } } };
}
function rig() {
  const raw: any[] = []; const writes: any[] = []; const chats: string[] = [];
  const client = Object.assign(new EventEmitter(), { state: 'play', version: '26.1', protocolVersion: 775,
    write(name: string, p: unknown) { writes.push({ name, p }); }, writeRaw(b: Buffer) { raw.push(b); } });
  const bot: any = Object.assign(new EventEmitter(), { _client: client, currentWindow: null, chat: (m: string) => chats.push(m) });
  installServerScreens(bot);
  return { bot, client, raw, writes, chats };
}
const ctx: any = { aborted: () => false };

describe('server screens (26.1 dialogs / books / death)', () => {
  it('parses an inline NBT dialog into title, body and buttons', () => {
    const d = parseDialog(nbtDialog(), 1);
    expect(d.title).toBe('修仙统计');
    expect(d.body).toEqual(['境界：凡人']);
    expect(d.buttons.map((b) => b.label)).toEqual(['查看灵根', '充值点券', '关闭']);
    expect(d.buttons[0].action).toEqual({ type: 'run_command', command: '/linggen' });
    expect(d.dialogType).toBe('multi_action');
    expect(renderScreen(d)).toContain('按钮 #0「查看灵根」');
  });

  it('tracks show_dialog/clear_dialog, ignores AuthMe login dialogs, and shows it in mc_window', () => {
    const { bot, client } = rig();
    const seen: unknown[] = []; onServerScreen(bot, (x) => seen.push(x?.title ?? null));
    client.emit('show_dialog', { dialog: { type: 'compound', name: '', value: { title: s('登录'), body: { type: 'compound', value: { type: s('minecraft:plain_message'), contents: s('请输入密码') } }, inputs: { type: 'list', value: { type: 'compound', value: [{ type: s('minecraft:text'), key: s('password') }] } } } } });
    expect(serverScreen(bot)).toBeNull();
    client.emit('show_dialog', nbtDialog());
    expect(serverScreen(bot)?.title).toBe('修仙统计');
    const r = readOpenWindow(bot);
    expect(r.screen?.title).toBe('修仙统计');
    expect(renderWindowReadout(r)).toContain('查看灵根');
    expect((viewerServerScreen(bot) as any).buttons).toHaveLength(3);
    client.emit('clear_dialog', {});
    expect(serverScreen(bot)).toBeNull();
    expect(viewerServerScreen(bot)).toEqual({ kind: 'none' });
    expect(seen).toEqual(['修仙统计', null]);
  });

  it('clicks run_command and custom buttons like vanilla, refuses spending buttons', async () => {
    const { bot, client, raw, chats } = rig();
    client.emit('show_dialog', nbtDialog());
    setTimeout(() => client.emit('clear_dialog', {}), 20);
    expect(await skillMenuClick(bot, { skill: 'menu_click', name: '灵根' } as any, ctx)).toContain('对话框已关闭');
    expect(chats).toEqual(['/linggen']);
    client.emit('show_dialog', nbtDialog());
    await expect(skillMenuClick(bot, { skill: 'menu_click', slot: 1 } as any, ctx)).rejects.toThrow(/充值/);
    expect(chats).toEqual(['/linggen']);
    setTimeout(() => client.emit('clear_dialog', {}), 20);
    expect(await skillMenuClick(bot, { skill: 'menu_click', slot: 2 } as any, ctx)).toContain('xiuxian:close');
    expect(raw).toHaveLength(1);
  });

  it('closes like Escape only when allowed; books close locally; death screen refuses', () => {
    const { bot, client } = rig();
    client.emit('show_dialog', nbtDialog({ can_close_with_escape: { type: 'byte', value: 0 } }));
    expect(() => skillMenuClose(bot)).toThrow(/不允许直接关闭/);
    client.emit('show_dialog', nbtDialog());
    expect(skillMenuClose(bot)).toContain('已关闭对话框');
    expect(serverScreen(bot)).toBeNull();
    client.emit('open_book', { hand: 0 });
    expect(skillMenuClose(bot)).toBe('已合上书本');
    bot.emit('death');
    expect(() => skillMenuClose(bot)).toThrow(/死亡/);
    bot.emit('respawn');
    expect(serverScreen(bot)).toBeNull();
  });
});


  it('fills book title and pages from the held written_book so mc_window can read the tutorial', () => {
    const { bot, client } = rig();
    bot.heldItem = {
      componentMap: new Map([
        ['written_book_content', { data: {
          title: { raw: '永恒世界 新手教程' },
          author: '永恒世界',
          pages: ['出生点是主城, 输入 /rtp 随机传送到野外开荒。', '迷路了输入 /spawn 回主城。'],
        } }],
      ]),
    };
    client.emit('open_book', { hand: 0 });
    const screen = serverScreen(bot);
    expect(screen?.kind).toBe('book');
    expect(screen?.title).toBe('永恒世界 新手教程');
    expect(screen?.body).toEqual(['作者 永恒世界', '出生点是主城, 输入 /rtp 随机传送到野外开荒。', '迷路了输入 /spawn 回主城。']);
    const readout = renderWindowReadout(readOpenWindow(bot));
    expect(readout).toContain('永恒世界 新手教程');
    expect(readout).toContain('/rtp');
    expect(readout).toContain('menu_close');
    expect(skillMenuClose(bot)).toBe('已合上书本');
    expect(serverScreen(bot)).toBeNull();
  });

describe('ghost menu escape', () => {
  it('menu_close with nothing tracked presses Escape on the last server window id', async () => {
    const { installOrphanWindowClose } = await import('../core/orphan-windows.ts');
    const { bot, client, writes } = rig();
    bot.closeWindow = () => {};
    const dispose = installOrphanWindowClose(bot, { graceMs: 10_000 });
    client.emit('open_window', { windowId: 7, inventoryType: 99, windowTitle: '"随机传送"' });
    client.emit('close_window', { windowId: 7 });
    writes.length = 0;
    expect(skillMenuClose(bot)).toContain('Esc');
    expect(writes).toEqual([{ name: 'close_window', p: { windowId: 7 } }]);
    dispose();
  });
});
