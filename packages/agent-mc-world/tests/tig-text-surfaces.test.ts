import { EventEmitter } from 'node:events';
import { describe, expect, it, afterEach } from 'vitest';
import { installServerDisplay, renderServerDisplayHud } from '../core/server-display.ts';
import { setMinecraftTextLanguage } from '../core/nbt-text.mjs';

const s = (value: string) => ({ type: 'string', value });
const c = (value: Record<string, unknown>) => ({ type: 'compound', value });
function fakeBot() {
  const client = new EventEmitter() as any;
  client.prependListener = client.on.bind(client);
  const bot: any = { _client: client, username: 'ag_example', bossBars: {}, inventory: { items: () => [] }, currentWindow: null };
  return { bot, client };
}
afterEach(() => setMinecraftTextLanguage(null));

describe('TIG 1.21.11 text surfaces (protocol 774 shapes, local)', () => {
  it('title/subtitle with translate, color and click; action bar with icon font; tab with hover; boss bar; blank-number sidebar', () => {
    setMinecraftTextLanguage({ 'gui.done': 'Done' });
    const { bot, client } = fakeBot();
    const h = installServerDisplay(bot);
    client.emit('set_title_text', { text: c({ translate: s('gui.done'), color: s('gold'), click_event: c({ action: s('run_command'), command: s('/skills') }) }) });
    client.emit('set_title_subtitle', { text: c({ text: s('副标题'), color: s('#55ffaa') }) });
    client.emit('system_chat', { content: c({ text: s('\uE101 金币 +5'), font: s('tig:hud') }), isActionBar: true });
    client.emit('system_chat', { content: c({ text: s('点我签到'), hover_event: c({ action: s('show_text'), value: s('打开签到菜单') }), click_event: c({ action: s('run_command'), command: s('/litesignin:signin gui') }) }), isActionBar: false });
    client.emit('playerlist_header', { header: c({ text: s('TIG'), hover_event: c({ action: s('show_text'), value: s('欢迎') }) }), footer: s('{"text":"Ping: 30"}') });
    client.emit('scoreboard_objective', { name: 'mb', action: 0, displayText: c({ text: s('MiniBoardX') }), type: 0, number_format: 0 });
    client.emit('scoreboard_display_objective', { position: 1, name: 'mb' });
    client.emit('scoreboard_score', { itemName: 'line1', scoreName: 'mb', value: 3, display_name: c({ text: s('▪ 金币 0') }) });
    bot.bossBars = { a: { entityUUID: 'x', title: c({ text: s('世界Boss 剩余'), color: s('red') }), health: 0.5 } };
    const snap = h.snapshot();
    expect(snap.title).toMatchObject({ title: 'Done', subtitle: '副标题' });
    expect(snap.richNotes?.title).toContain('执行 /skills');
    expect(snap.actionBar?.text).toBe('\uE101 金币 +5');
    expect(snap.richNotes?.actionBar).toContain('U+E101@tig:hud');
    expect(snap.tabHeader).toBe('TIG');
    expect(snap.tabFooter).toBe('Ping: 30');
    expect(snap.richNotes?.tab).toContain('悬浮: 欢迎');
    expect(snap.richNotes?.system[0].note).toContain('执行 /litesignin:signin gui');
    expect(snap.scoreboards[0].rows[0]).toMatchObject({ displayName: '▪ 金币 0', right: '' });
    expect(snap.bossBars[0]).toMatchObject({ title: '世界Boss 剩余', progress: 0.5 });
    const hud = renderServerDisplayHud(snap);
    expect(hud).toContain('▪ 金币 0');
    expect(hud).not.toContain('▪ 金币 0 3');
    expect(hud).toContain('世界Boss 剩余；条形进度 50%');
    expect(hud).toContain('列表栏 TIG / Ping: 30');
    h.stop();
  });
});
