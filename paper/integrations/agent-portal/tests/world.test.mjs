import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { publicGrowth, parsePublicLog } from '../src/world-catalog.mjs';
import { siteFixture, testPassword } from './helpers.mjs';

test('growth uses certified grades and never promotes from fame alone; zero and unknown remain distinct', () => {
  assert.equal(publicGrowth({ joined: 'yes', fame: 500, rituals: { certified: 1 } }, {}, 0).rank, '黑铁 III');
  assert.equal(publicGrowth({ joined: 'yes', fame: 500 }, { academy: { grade: 5 } }, 3).rank, '黑铁 I');
  assert.equal(publicGrowth(null, null, null).rank, null);
  assert.equal(publicGrowth({ joined: 'yes', fame: 0, completed: 0 }, null, 0).completed, 0);
  assert.equal(publicGrowth({ joined: 'yes', fame: 0 }, { combat: 'private-unrecognized-class' }, -1).level, null);
});

test('public player projection contains actual growth with no UUID, inventory, position, or private profile', async t => {
  const f = await siteFixture(t); const result = await f.admin.request('/world/players');
  assert.equal(result.status, 200); const player = result.data.players[0];
  assert.equal(player.growth.rank, '黑铁 II'); assert.equal(player.growth.level, 21); assert.equal(player.growth.completed, 3);
  assert.equal(player.growth.profession, 'warrior'); assert.equal(result.data.freshness, 'saved');
  const text = JSON.stringify(result.data);
  for (const forbidden of [f.uuid, 'private-profile-value', 'private-inventory-value', 'Pos', 'Inventory', 'password']) assert.ok(!text.includes(forbidden), forbidden);
});

test('public event parser admits canonical lifecycle/advancement lines and rejects chat, whispers and tool results', () => {
  assert.equal(parsePublicLog('[12:00:00] [Server thread/INFO]: ag_Alpha joined the game', '2026-10-20').kind, 'join');
  assert.equal(parsePublicLog('[12:00:00] [Server thread/INFO]: ag_Alpha has made the advancement [Stone Age]', '2026-10-20').kind, 'advancement');
  for (const line of [
    '[12:00:00] [Server thread/INFO]: <ag_Alpha> ag_Beta joined the game',
    '[12:00:00] [Server thread/INFO]: ag_Alpha whispers to you: joined the game',
    '[12:00:00] [Server thread/INFO]: MC_STATUS {"position":[1,2,3]}',
    '[12:00:00] [Server thread/INFO]: [SomePlugin] ag_Alpha joined the game',
    '[12:00:00] [Async Chat Thread - #1/INFO]: ag_Alpha joined the game',
    '[99:00:00] [Server thread/INFO]: ag_Alpha joined the game'
  ]) assert.equal(parsePublicLog(line, '2026-10-20'), null, line);
});

test('events persist de-duplicated public facts, retain day precision and ignore unfinished log lines', async t => {
  const f = await siteFixture(t); const log = path.join(f.root, 'game/logs/latest.log');
  const complete = '[12:01:00] [Server thread/INFO]: ag_Alpha joined the game\n';
  await fs.writeFile(log, complete + '[12:02:00] [Server thread/INFO]: <ag_Alpha> /login private-message-test\n' + '[12:03:00] [Server thread/INFO]: ag_Alpha left the game');
  const first = await f.admin.request('/world/events');
  assert.equal(first.data.total, 2); assert.ok(first.data.events.some(e => e.timePrecision === 'day' && e.title.includes('营地补给')));
  assert.equal((await f.admin.request('/world/events')).data.total, 2);
  await fs.appendFile(log, '\n'); assert.equal((await f.admin.request('/world/events')).data.total, 3);
  const databaseText = JSON.stringify(f.portal.store.db.prepare('SELECT * FROM public_events').all());
  assert.ok(!databaseText.includes('private message')); assert.ok(!databaseText.includes(f.uuid));
  assert.equal((await f.admin.request('/world/events?kind=leave')).data.events.length, 1);
  assert.equal((await f.admin.request('/world/events?limit=999')).status, 400);
  assert.equal((await f.admin.request('/world/events?page=-1')).status, 400);
});

test('only reauthenticated administrators publish notices, which are separate from security audit data', async t => {
  const f = await siteFixture(t), user = f.client(); await user.init();
  await user.request('/accounts', 'POST', { username: 'ordinary-user', password: testPassword });
  assert.equal((await user.request('/admin/notices', 'POST', { title: 'bad', body: 'bad' })).status, 403);
  assert.equal((await f.admin.request('/admin/notices', 'POST', { title: '<img onerror=alert(1)>', body: '游戏更新已完成。\n命令：/mycli help' })).status, 201);
  const notices = await user.request('/world/events?kind=notice');
  assert.equal(notices.data.total, 1); assert.match(notices.data.events[0].body, /mycli help/);
  assert.ok(!JSON.stringify(notices.data).includes('session.login'));
  assert.equal((await f.admin.request('/admin/notices', 'POST', { title: 'x', body: 'x'.repeat(2001) })).status, 400);
});
