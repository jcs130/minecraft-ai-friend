import { describe, expect, it } from 'vitest';
import { EventCondenser, compactEvents } from '../src/client/index.ts';

let cursor = 0;
const ev = (text: string, type = 'mymc.chat') => ({ cursor: ++cursor, ts: '2026-10-20T00:45:05.000+08:00', type, source: 'mymc', origin: 'external' as const, text });

describe('EventCondenser', () => {
  it('condenses login, MC_* payloads, tips, countdowns and repeats; keeps chat and danger', () => {
    const c = new EventCondenser();
    c.push([
      ev('[MC 登录消息] [MC_AUTH_LOGIN] 请先登录：/login 密码（已启用两步验证则追加验证码）。'),
      ev('[MC 登录消息] MC_AUTH_STATE {"status":"pending","authorized":false,"playerUuid":"u"}'),
      ev('[MC 登录消息] MC_AUTH_STATE {"status":"authenticated","authorized":true,"playerUuid":"u"}'),
      ev('[MC 登录消息] [MC_AUTH_SUCCESS] 登录成功，可以开始游戏。'),
      ev('[MC 系统] MC_STATUS {"adventurerRank":"青铜 III","mana":20.0,"maxMana":20.0,"mainStage":"register","nextCommand":"/mycli guild join","downed":false,"playerUuid":"u"}'),
      ev('[MC 系统] MC_GUIDE_NEXT {"title":"先登记为冒险者","message":"旅人营地的石质地坪受保护。","nextCommand":"/mycli guild join","playerUuid":"u"}'),
      ev('[MC 插件] 槽位1「✦ 技能罗盘」：手持右键打开技能罗盘，或 /mycli menu；查询免费。'),
      ev('[MC 插件] [照片] 用 /mycli photo menu 选角度。'),
      ev('[Minecraft] ☾ 星灯夜巡 | 2:15 状态条进度为 75%。', 'mymc.event'),
      ev('[Minecraft] ☾ 星灯夜巡 | 1:30 状态条进度为 50%。', 'mymc.event'),
      ev('[游戏玩家历史] 账号 ag_CorMy；本地未找到该账号已绑定且未过期的关系笔记。', 'mymc.memory'),
      ev('[游戏玩家历史] 账号 ag_CorMy；本地未找到该账号已绑定且未过期的关系笔记。', 'mymc.memory'),
      ev('[Minecraft] 西南边有村民的动静。', 'mymc.event'),
      ev('[Minecraft] 西南边有村民的动静。', 'mymc.event'),
      ev('[MC] ag_CorMy: 欢迎回来 Jojo！'),
      ev('[Minecraft] 濒死!生命只剩 3/20', 'mymc.event'),
    ]);
    expect(c.view().map(e => e.text)).toEqual([
      '[登录状态] authenticated（已授权）',
      '[MC 登录消息] [MC_AUTH_SUCCESS] 登录成功，可以开始游戏。',
      '[服务器状态] 青铜 III；魔力 20/20；主线 register；下一步 /mycli guild join',
      '[服务器引导] 先登记为冒险者；旅人营地的石质地坪受保护。；下一步 /mycli guild join',
      '[Minecraft] ☾ 星灯夜巡 | 1:30 状态条进度为 50%。',
      '[玩家历史] 无本地关系笔记：ag_CorMy（不代表初次见面，可查 mymc_memory）',
      '[Minecraft] 西南边有村民的动静。',
      '[MC] ag_CorMy: 欢迎回来 Jojo！',
      '[Minecraft] 濒死!生命只剩 3/20',
    ]);
    expect(c.stats).toMatchObject({ seen: 16, dropped: 3 });
    expect(compactEvents(c.view()).length).toBeLessThanOrEqual(10);
  });
  it('rules are configurable', () => {
    const c = new EventCondenser({ disable: ['tips'], rules: [{ id: 'mute-photo', match: /\[照片\]/, action: 'drop' }] });
    c.push([ev('[MC 插件] 槽位1 x'), ev('[MC 插件] [照片] y')]);
    expect(c.view().map(e => e.text)).toEqual(['[MC 插件] 槽位1 x']);
  });
});

it('since() returns new events plus a short tail', () => {
  const c = new EventCondenser();
  const batch = [ev('[MC] a: 1'), ev('[MC] a: 2'), ev('[MC] a: 3'), ev('[MC] a: 4')];
  c.push(batch);
  expect(c.since(batch[2].cursor, 1).map(e => e.text)).toEqual(['[MC] a: 3', '[MC] a: 4']);
});

it('merges "no local notes" player-history lines into one', () => {
  const c = new EventCondenser();
  for (const name of ['Goddess', 'ag_CorMy', 'ag_NEKO'])
    c.push([ev(`[游戏玩家历史] 账号 ${name}；本地未找到该账号已绑定且未过期的关系笔记；这不证明初次见面。按已确认账号回查已有宿主档案或 mymc_memory，身份不明时保留未知。`, 'mymc.memory')]);
  expect(c.view().map(e => e.text)).toEqual(['[玩家历史] 无本地关系笔记：Goddess、ag_CorMy、ag_NEKO（不代表初次见面，可查 mymc_memory）']);
});

it('compactEvents prints clock time in the requested zone for Z and offset stamps', async () => {
  const { compactEvents: ce } = await import('../src/client/index.ts');
  const out = ce([{ ...ev('a'), ts: '2026-10-19T17:17:34.000Z' }, { ...ev('b'), ts: '2026-10-20T01:17:35.000+08:00' }], 10, 200, 'Asia/Shanghai');
  expect(out.map(e => e.at)).toEqual(['01:17:34', '01:17:35']);
});
