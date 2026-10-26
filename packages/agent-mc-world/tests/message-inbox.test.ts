import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MESSAGE_LIMIT, MessageInbox } from '../src/client/message-inbox.ts';

const event = (text: string, ts = '2026-01-01T00:00:00Z', senderKey = 'minecraft') =>
  ({ ts, text, source: 'minecraft', type: 'minecraft.chat', senderKey });

describe('received Minecraft messages', () => {
  it('expands the observed batch selector without pretending retained messages were evicted', () => {
    const inbox = new MessageInbox('example.test:25565:ag_Player');
    inbox.observe(event('[MC 系统] Room result: one of three cleared.'));
    inbox.observe(event('[MC 私聊] Alex: I will join after harvesting.', '2026-01-01T00:00:01Z', 'Alex'));
    const result = inbox.readout({ action: 'read', ids: ['message_1', 'message_2', 'message_1'] });
    expect(result.failed).toBeUndefined();
    expect(result.text).toContain('one of three cleared'); expect(result.text).toContain('senderKey=Alex');
    expect(result.text.match(/\[Minecraft收到的消息 message_1\]/g)).toHaveLength(1);
    expect(inbox.readout({ ids: ['message_1', 'message_2'] })).toEqual(result);
    expect(inbox.index()).toContain('2 条未标记已考虑');
    for (const args of [{action:'read'}, {action:'read', id:''}, {action:'read', ids:[]},
      {action:'read', ids:['message_1', 2]}, {action:'read', id:'message_1', ids:['message_2']},
      {action:'read', ids:Array(17).fill('message_1')}, {action:'search', query:'Alex', ids:['message_2']}]) {
      expect(inbox.readout(args)).toMatchObject({failed:true,meta:{admission:{rule:'messages.selector'}}});
    }
    const missing = inbox.readout({action:'read',ids:['message_1','message_36806']});
    expect(missing).toMatchObject({failed:true,meta:{admission:{rule:'messages.retained-id',missingIds:['message_36806']}}});
    expect(missing.text).not.toContain('one of three cleared');
    expect(inbox.readout({action:'read'}).text).toContain('尚未查找消息');
  });
  it('versions query results by scope and normalized selector, preserving changes, review and page boundaries', () => {
    const inbox = new MessageInbox('example.test:25565:ag_Player');
    inbox.observe(event('[MC 系统] Room closed.'));
    const query = {action:'search',query:'room',limit:1};
    const first = inbox.readout(query);
    expect(inbox.readout({action:'search',keyword:' ROOM ',limit:1}).meta).toEqual(first.meta);
    inbox.observe(event('[MC 系统] Unrelated notice.'));
    expect(inbox.readout(query).meta).toEqual(first.meta);
    inbox.observe(event('[MC 系统] Room closed.', '2026-01-01T00:01:00Z'));
    expect(inbox.readout(query).meta).not.toEqual(first.meta);
    expect(inbox.readout({...query,offset:1}).meta).not.toEqual(inbox.readout(query).meta);
    inbox.readout({action:'review',ids:['message_1']});
    expect(inbox.readout(query).text).toContain('匹配 0 条');
    expect(inbox.readout({...query,status:'all'}).text).toContain('匹配 1 条');
    const other = new MessageInbox('other.test:25565:ag_Player'); other.observe(event('[MC 系统] Room closed.'));
    expect(other.readout(query).meta).not.toEqual(first.meta);
  });
  it('reads an exact id without action, never silently ignores a selector, and exposes stable scoped revisions', () => {
    const inbox=new MessageInbox('example.test:25565:ag_Player');
    inbox.observe(event('[MC 系统] Original message body.'));
    const explicit=inbox.readout({action:'read',id:'message_1'}),implicit=inbox.readout({id:'message_1'});
    expect(implicit).toEqual(explicit);expect(implicit.text).toContain('[Minecraft收到的消息 message_1]');
    expect(inbox.readout({action:'search',query:'Original',id:'message_1'}).failed).toBe(true);
    inbox.observe(event('[MC 系统] Unrelated body.','2026-01-01T00:01:00Z'));
    expect(inbox.readout({id:'message_1'}).meta).toEqual(explicit.meta);
    inbox.observe(event('[MC 系统] Original message body.','2026-01-01T00:02:00Z'));
    expect(inbox.readout({id:'message_1'}).meta).not.toEqual(explicit.meta);
    const other=new MessageInbox('other.test:25565:ag_Player');other.observe(event('[MC 系统] Original message body.'));
    expect(other.readout({id:'message_1'}).meta).not.toEqual(explicit.meta);
  });
  it('filters compatibility keyword searches and rejects missing or conflicting search terms', () => {
    const inbox = new MessageInbox('example.test:25565:ag_Player');
    inbox.observe(event('[MC 系统] 麦田成熟了'));
    inbox.observe(event('[MC 系统] 星芒箭命中'));
    expect(inbox.readout({ action: 'search', keyword: '麦田' }).text).toContain('匹配 1 条');
    expect(inbox.readout({ action: 'search', keyword: '麦田' }).text).not.toContain('星芒箭');
    expect(inbox.readout({ action: 'search' }).failed).toBe(true);
    expect(inbox.readout({ action: 'search', query: '麦田', keyword: '星芒箭' }).failed).toBe(true);
  });
  it('keeps private source and original timestamp without recording HUD or self echoes', () => {
    const inbox = new MessageInbox('example.test:25565:ag_Player');
    const raw = '[MC 私聊] [控制台 -> 我] 新技能说明请用 /help skills 查看。';
    inbox.observe(event(raw));
    inbox.observe(event('[MC 动作栏] 魔力 50/100'));
    inbox.observe(event('[MC 私聊发出] You whisper to Alex: 好的'));
    inbox.observe(event('[MC] Self: 自己说的话'), false);
    expect(inbox.readout({}).text).toContain('匹配 1 条');
    expect(inbox.index()).toContain('[private] 2026-01-01T00:00:00Z');
    const read = inbox.readout({ action: 'read', id: 'message_1' }).text;
    expect(read).toContain(raw);
    expect(read).toContain('senderKey=minecraft');
    expect(read).toContain('旧消息不证明当前状态');
    expect(inbox.index()).toContain('1 条未标记已考虑');
  });

  it('separates querying, reading and explicit review across reconstruction', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mymc-inbox-'));
    try {
      const inbox = new MessageInbox('example.test:25565:ag_Player', dir);
      inbox.observe(event('[MC 系统] [活动] 居民事务板已更新。'));
      inbox.observe({ ...event('[MC 私聊] Alex: 一起去看看', '2026-01-01T00:01:00Z', 'Alex'),
        meta: { channel: 'private', uname: 'Alex', identityEvidence: 'packet-sender', chatTransport: 'chat', senderUuid: 'uuid-alex' } });
      inbox.readout({ action: 'read', id: 'message_1' });
      expect(inbox.readout({ action: 'review', ids: ['message_1', 'missing'] }).failed).toBe(true);
      expect(inbox.index()).toContain('2 条未标记已考虑');
      expect(inbox.readout({ action: 'review', ids: ['message_1'] }).text).toContain('不表示已执行');
      const restored = new MessageInbox('example.test:25565:ag_Player', dir);
      expect(restored.index()).toContain('1 条未标记已考虑');
      expect(restored.readout({ id: 'message_2' }).text).toContain('"identityEvidence":"packet-sender"');
      expect(restored.readout({ query: '居民事务板' }).text).toContain('匹配 0 条');
      expect(restored.readout({ action: 'search', status: 'all', query: '居民事务板' }).text).toContain('message_1');
      expect(new MessageInbox('other.test:25565:ag_Player', dir).index()).toBe('');
      expect(new MessageInbox('example.test:25565:ag_Other', dir).index()).toBe('');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('consolidates repeated system text while retaining changed notices and repeated player speech', () => {
    const inbox = new MessageInbox('example.test:25565:ag_Player');
    const raw = '[MC 系统] [活动] 新玩法已开放。';
    inbox.observe(event(raw));
    inbox.readout({ action: 'review', ids: ['message_1'] });
    inbox.observe(event(raw, '2026-01-01T01:00:00Z'));
    inbox.observe(event('[MC 系统] [活动] 新玩法暂停维护。', '2026-01-01T01:01:00Z'));
    for (let i = 0; i < 2; i++) inbox.observe(event('[MC 私聊] Alex: 过来一下', '2026-01-01T01:02:00Z', 'Alex'));
    expect(inbox.readout({ status: 'all' }).text).toContain('匹配 4 条');
    expect(inbox.readout({}).text).toContain('匹配 3 条');
    expect(inbox.readout({ action: 'read', id: 'message_1' }).text).toContain('收到 2 次');
    expect(inbox.readout({ action: 'read', id: 'message_1' }).text).toContain('最近 2026-01-01T01:00:00Z');
  });

  it('bounds the index and paged list without expanding full messages into every request', () => {
    const inbox = new MessageInbox('example.test:25565:ag_Player');
    for (let i = 0; i < 23; i++) inbox.observe(event(`[MC 系统] Notice ${i} ${'正文'.repeat(1000)}`));
    inbox.observe(event('[MC 私聊] Alex: 技能说明 /help skills', '2026-01-01T00:01:00Z', 'Alex'));
    expect(inbox.index().length).toBeLessThan(700);
    const page = inbox.readout({ limit: 2, offset: 1 }).text;
    expect(page).toContain('展示 2 条');
    expect(page).toContain('message_23');
    expect(page).not.toContain('message_24');
    expect(page.length).toBeLessThan(700);
    expect(inbox.readout({ action: 'read', id: 'message_23' }).text).toContain('正文'.repeat(1000));
    expect(inbox.readout({ channel: 'private', query: 'SKILLS' }).text).toContain('匹配 1 条');
  });

  it('evicts reviewed records first and reports the retention boundary', () => {
    const inbox = new MessageInbox('example.test:25565:ag_Player');
    for (let i = 0; i < MESSAGE_LIMIT; i++) inbox.observe(event(`[MC 系统] Notice ${i}`));
    inbox.readout({ action: 'review', ids: ['message_2'] });
    inbox.observe(event('[MC 系统] 最新公告'));
    expect(inbox.readout({ action: 'read', id: 'message_1' }).failed).toBeUndefined();
    expect(inbox.readout({ action: 'read', id: 'message_2' }).failed).toBe(true);
    expect(inbox.readout({ status: 'all' }).text).toContain(`匹配 ${MESSAGE_LIMIT} 条`);
    expect(inbox.readout({ status: 'all' }).text).toContain('已移出 1 条');
  });

  it('reports unreadable history and keeps the damaged file while receiving new messages', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mymc-inbox-damaged-'));
    try {
      const inbox = new MessageInbox('example.test:25565:ag_Player', dir);
      inbox.observe(event('[MC 系统] 旧公告'));
      const path = join(dir, readdirSync(dir)[0]);
      writeFileSync(path, '{broken');
      const restored = new MessageInbox('example.test:25565:ag_Player', dir);
      expect(restored.index()).toContain('历史未验证');
      restored.observe(event('[MC 系统] 新公告'));
      expect(restored.readout({}).text).toContain('新公告');
      expect(restored.index()).toContain('历史未验证');
      expect(readFileSync(path, 'utf8')).toBe('{broken');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('reports oversized originals and does not merge different unseen suffixes', () => {
    const inbox = new MessageInbox('example.test:25565:ag_Player');
    const common = '[MC 系统] ' + '详情'.repeat(20_000);
    inbox.observe(event(common + 'A'));
    inbox.observe(event(common + 'B'));
    expect(inbox.readout({}).text).toContain('匹配 2 条');
    expect(inbox.readout({ action: 'read', id: 'message_1' }).text).toContain('正文超过保存上限');
  });

  it('retains live observations on write failure and reports recovery after a later save', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mymc-inbox-write-'));
    const missing = join(dir, 'missing');
    try {
      const inbox = new MessageInbox('example.test:25565:ag_Player', missing);
      expect(() => inbox.observe(event('[MC 系统] 新公告'))).toThrow();
      expect(inbox.readout({}).text).toContain('新公告');
      expect(inbox.index()).toContain('重载后恢复未验证');
      expect(inbox.readout({ action: 'review', ids: ['message_1'] }).failed).toBe(true);
      mkdirSync(missing);
      inbox.observe(event('[MC 系统] 下一条公告'));
      expect(inbox.index()).not.toContain('写入失败');
      const restored = new MessageInbox('example.test:25565:ag_Player', missing);
      expect(restored.readout({ status: 'all' }).text).toContain('匹配 2 条');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
