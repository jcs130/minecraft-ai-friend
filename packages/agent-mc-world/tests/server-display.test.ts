import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  displaySlotName,
  installServerDisplay,
  readServerDisplay,
  renderServerDisplayHud,
  statsFromChatText,
  statsFromLoreLines,
  viewerScoreboardState,
} from '../core/server-display.ts';
import { minecraftTextComponent } from '../core/nbt-text.mjs';

const titleNbt = {
  type: 'compound',
  value: {
    text: { type: 'string', value: '' },
    extra: { type: 'list', value: { type: 'compound', value: [
      { bold: { type: 'byte', value: 1 }, color: { type: 'string', value: 'gold' }, text: { type: 'string', value: '永恒世界' } },
    ] } },
  },
};

const displayNameNbt = (text: string) => ({
  type: 'compound',
  value: { text: { type: 'string', value: text } },
});

function fakeBot() {
  const client = new EventEmitter() as EventEmitter & { prependListener: typeof EventEmitter.prototype.on };
  client.prependListener = client.on.bind(client);
  const bot: any = { _client: client, username: 'CorMy', scoreboards: {}, teamMap: {}, teams: {}, bossBars: {}, inventory: { items: () => [] }, currentWindow: null };
  return { bot, client };
}

describe('26.1 server display packets', () => {
  it('maps sidebar slot 1', () => {
    expect(displaySlotName(1)).toBe('sidebar');
    expect(displaySlotName(0)).toBe('list');
    expect(displaySlotName(6)).toBe('sidebar.team.dark_aqua');
    expect(displaySlotName(5)).toBe('sidebar.team.dark_green');
  });

  it('records scoreboard scores that have no legacy action field and uses display_name', () => {
    const { bot, client } = fakeBot();
    const handle = installServerDisplay(bot);
    client.emit('scoreboard_objective', { name: 'ww', action: 0, displayText: titleNbt });
    client.emit('scoreboard_score', { itemName: 'line_a', scoreName: 'ww', value: 15, display_name: displayNameNbt('修为 » 凡人') });
    client.emit('scoreboard_score', { itemName: 'line_b', scoreName: 'ww', value: 14, display_name: displayNameNbt('游戏币 » 20') });
    client.emit('scoreboard_display_objective', { name: 'ww', position: 1 });
    const snapshot = handle.snapshot();
    expect(minecraftTextComponent(titleNbt)).toBe('永恒世界');
    expect(snapshot.scoreboards).toEqual([expect.objectContaining({
      slot: 'sidebar',
      objective: 'ww',
      title: '永恒世界',
    })]);
    expect(snapshot.scoreboards[0].rows).toEqual([
      { name: 'line_a', displayName: '修为 » 凡人', value: 15 },
      { name: 'line_b', displayName: '游戏币 » 20', value: 14 },
    ]);
    expect(viewerScoreboardState(snapshot)).toEqual({
      title: '永恒世界',
      rows: [
        { name: '修为 » 凡人', value: 15 },
        { name: '游戏币 » 20', value: 14 },
      ],
    });
    expect(renderServerDisplayHud(snapshot)).toContain('永恒世界');
    expect(renderServerDisplayHud(snapshot)).toContain('修为 » 凡人 15');
    handle.stop();
  });

  it('applies reset_score and does not invent missing rows', () => {
    const { bot, client } = fakeBot();
    const handle = installServerDisplay(bot);
    client.emit('scoreboard_objective', { name: 'ww', action: 0, displayText: 'board' });
    client.emit('scoreboard_score', { itemName: 'keep', scoreName: 'ww', value: 2 });
    client.emit('scoreboard_score', { itemName: 'drop', scoreName: 'ww', value: 1 });
    client.emit('scoreboard_display_objective', { name: 'ww', position: 1 });
    client.emit('reset_score', { entity_name: 'drop', objective_name: 'ww' });
    const rows = handle.snapshot().scoreboards[0].rows;
    expect(rows.map((row) => row.name)).toEqual(['keep']);
    handle.stop();
  });

  it('unwraps team prefixes used as realm tags', () => {
    const { bot, client } = fakeBot();
    const handle = installServerDisplay(bot);
    client.emit('teams', {
      team: 'jiedan',
      mode: 'add',
      name: displayNameNbt('结丹'),
      prefix: displayNameNbt('[结丹]'),
      suffix: displayNameNbt(''),
      players: ['ZhiZhang'],
    });
    const snapshot = handle.snapshot();
    expect(snapshot.teams).toEqual([expect.objectContaining({
      name: 'jiedan', displayName: '结丹', prefix: '[结丹]', members: ['ZhiZhang'],
    })]);
    handle.stop();
  });

  it('keeps action bar, tab list and plugin channels as received', () => {
    const { bot, client } = fakeBot();
    const handle = installServerDisplay(bot);
    client.emit('action_bar', { text: displayNameNbt('您已进入安全区') });
    client.emit('playerlist_header', { header: displayNameNbt(''), footer: displayNameNbt('') });
    client.emit('custom_payload', { channel: 'minecraft:brand', data: Buffer.alloc(0) });
    client.emit('custom_payload', { channel: 'vv:server_details', data: Buffer.alloc(0) });
    client.emit('experience', { experienceBar: 0, level: 0, totalExperience: 0 });
    const snapshot = handle.snapshot();
    expect(snapshot.actionBar?.text).toBe('您已进入安全区');
    expect(snapshot.pluginChannels).toEqual(['minecraft:brand', 'vv:server_details']);
    expect(renderServerDisplayHud(snapshot)).toContain('动作栏 您已进入安全区');
    handle.stop();
  });
});

describe('generic captured 修仙 text', () => {
  it('parses currency system chat actually sent by 永恒世界', () => {
    expect(statsFromChatText('你拥有的游戏币为:$20 - 本服的ip为:1.mcyyy.com')).toEqual([
      expect.objectContaining({ label: '游戏币', value: '20', source: 'system-chat' }),
    ]);
    expect(statsFromChatText('余额：$20')).toEqual([
      expect.objectContaining({ label: '游戏币', value: '20' }),
    ]);
    expect(statsFromChatText('[系统] 您有 0 多个点劵。')).toEqual([
      expect.objectContaining({ label: '点券', value: '0' }),
    ]);
    expect(statsFromChatText('[结丹]<0O0O> 昨天挖了几组钻石原矿都没出灵石')).toEqual([]);
  });

  it('parses 个人信息 menu lore captured on this server', () => {
    const lines = [
      '===== ✦ CorMy ✦ =====',
      '▪ 点券 » 0',
      '▪ 游戏币 » 20',
      '▪ 修为 » 凡人',
      '▪ 战力 » 0',
      '▪ 经验加成 » +0%',
      '========================',
    ];
    expect(statsFromLoreLines(lines)).toEqual([
      expect.objectContaining({ label: '点券', value: '0', source: 'item-lore' }),
      expect.objectContaining({ label: '游戏币', value: '20' }),
      expect.objectContaining({ label: '修为', value: '凡人' }),
      expect.objectContaining({ label: '战力', value: '0' }),
      expect.objectContaining({ label: '经验加成', value: '+0%' }),
    ]);
  });

  it('parses starter quest progress lines without inventing totals', () => {
    expect(statsFromLoreLines([
      '○ 击杀敌对生物 0/10',
      '○ 挖掘铁矿 0/10',
      '○ 砍伐原木 0/32',
      '○ 在聊天栏说一句话 0/1',
    ])).toEqual([
      expect.objectContaining({ label: '击杀敌对生物', value: '0/10' }),
      expect.objectContaining({ label: '挖掘铁矿', value: '0/10' }),
      expect.objectContaining({ label: '砍伐原木', value: '0/32' }),
      expect.objectContaining({ label: '在聊天栏说一句话', value: '0/1' }),
    ]);
  });

  it('records system chat into the live snapshot', () => {
    const { bot, client } = fakeBot();
    const handle = installServerDisplay(bot);
    client.emit('system_chat', { content: '你拥有的游戏币为:$20 - 本服的ip为:1.mcyyy.com', isActionBar: false });
    client.emit('system_chat', { content: '[系统] 您有 0 多个点劵。', isActionBar: false });
    const snapshot = readServerDisplay(bot);
    expect(snapshot.stats).toEqual([
      expect.objectContaining({ label: '点券', value: '0' }),
      expect.objectContaining({ label: '游戏币', value: '20' }),
    ]);
    const hud = renderServerDisplayHud(snapshot);
    expect(hud).toContain('游戏币 20');
    expect(hud).toContain('点券 0');
    expect(hud).not.toContain('魔力');
    handle.stop();
  });
});


it('does not refresh the receive time just because requestFacts samples unchanged lore', () => {
  const client = new EventEmitter();
  const item = {name:'player_head',customName:'个人信息',lore:['▪ 修为 » 凡人']};
  const bot:any={_client:client,username:'CorMy',inventory:{items:()=>[item]}};
  const handle=installServerDisplay(bot);
  const first=handle.snapshot().stats.find(x=>x.label==='修为')!;
  const second=handle.snapshot().stats.find(x=>x.label==='修为')!;
  expect(first.at).toBe(second.at);
  expect(first.text).toContain('▪ 修为 » 凡人');
  expect(handle.snapshot().selfTeam).toBeNull();
  handle.stop();
});

it('parses the ACTUAL 26.1 flattened menu lore, without requiring spaces',()=>{
 const lines=['=====✦CorMy✦=====','▪ 点券»0','▪ 游戏币»20','▪ 修为»凡人','▪ 战力»0','▪ 经验加成»+0%'];
 expect(statsFromLoreLines(lines,'个人信息',100)).toMatchObject([
 {label:'点券',value:'0'},{label:'游戏币',value:'20'},{label:'修为',value:'凡人'},{label:'战力',value:'0'},{label:'经验加成',value:'+0%'}]);
 expect(statsFromChatText('<OtherPlayer> 你拥有的游戏币为:$99999',100)).toEqual([]);
});

it('blank current fields stay unknown, command help is not promoted to self stats',()=>{
 expect(statsFromLoreLines(['▪ 战力»','▪ 回家»/home 名称'])).toMatchObject([{label:'战力',value:'未知（服务器未提供）'}]);
});
