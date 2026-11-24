import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { stripCustomGlyphs, parseTrChatLine, clickCommands, parseTeleportRequest, parseTeleportWarmup } from '../src/chat.mjs';
import { applyVulcanPace } from '../src/pace.mjs';
import { observeTangerine } from '../src/observer.mjs';

test('CraftEngine/CustomNameplates private-use glyphs are stripped and counted', () => {
  const r = stripCustomGlyphs('\uE001\uE002 [公会] 星猫 \u{F0001}你好');
  assert.equal(r.text, '[公会] 星猫 你好');
  assert.equal(r.glyphs, 3);
  assert.equal(stripCustomGlyphs('💀 普通表情').glyphs, 0);
});

test('TrChat lines need a known player; plugin notices with >>> are not players', () => {
  const known = (n) => n === 'Player_A';
  assert.deepEqual(parseTrChatLine('\uE010[萌新] Player_A >>> 听见了', known), { sender: 'Player_A', text: '听见了' });
  assert.equal(parseTrChatLine('LiteSignIn >>> 你今天还没有签到!', known), null);
});

test('HuskHomes request: clickable accept/deny from the component (both 1.21 and 26.x click shapes)', () => {
  const legacy = { text: '', extra: [{ text: 'Player_B 请求传送到你的位置 ' },
    { text: '[接受]', clickEvent: { action: 'run_command', value: '/huskhomes:tpaccept Player_B' } },
    { text: '[拒绝]', clickEvent: { action: 'run_command', value: '/huskhomes:tpdeny Player_B' } }] };
  const r = parseTeleportRequest('Player_B 请求传送到你的位置 [接受] [拒绝]', legacy);
  assert.equal(r.from, 'Player_B'); assert.equal(r.kind, 'tpa'); assert.equal(r.fromClick, true);
  assert.equal(r.accept, '/huskhomes:tpaccept Player_B'); assert.equal(r.deny, '/huskhomes:tpdeny Player_B');
  const modern = { text: 'x', extra: [{ text: '✔', click_event: { action: 'run_command', command: '/tpaccept Player_C' } }] };
  assert.deepEqual(clickCommands(modern), [{ label: '✔', command: '/tpaccept Player_C' }]);
  const plain = parseTeleportRequest('Player_C 请求传送到你的位置', null);
  assert.equal(plain.accept, '/tpaccept Player_C'); assert.equal(plain.fromClick, false);
  assert.equal(parseTeleportRequest('已接受 Player_C 的传送请求', null), null);
});

test('teleport warm-up and completion', () => {
  assert.deepEqual(parseTeleportWarmup('你将在 3 秒后被传送,请不要移动…'), { state: 'warmup', seconds: 3 });
  assert.deepEqual(parseTeleportWarmup('传送完成!'), { state: 'done' });
  assert.equal(parseTeleportWarmup('随便说说'), null);
});

test('Vulcan clamps survive later core retuning', () => {
  const m = { allowSprinting: true, allowParkour: true, canDig: true, allow1by1towers: true, scafoldingBlocks: [1, 2] };
  applyVulcanPace(m);
  m.allowSprinting = true; m.canDig = true; m.allowParkour = true;
  assert.equal(m.allowSprinting, false); assert.equal(m.canDig, false); assert.equal(m.allowParkour, false); assert.equal(m.allow1by1towers, false);
  assert.deepEqual(m.scafoldingBlocks, []);
  assert.equal(applyVulcanPace(m), true);
});

test('observer records requests, accepts the forced resource pack, and detaches on end', () => {
  const bot = new EventEmitter();
  bot.username = 'ag_test'; bot.players = { Player_A: {}, ag_test: {} };
  let accepted = 0; bot.acceptResourcePack = () => { accepted++; };
  const obs = observeTangerine(bot, { clock: () => 't' });
  const msg = (text, json) => ({ toString: () => text, json });
  bot.emit('message', msg('Player_A 请求传送到你的位置'), 'system');
  bot.emit('message', msg('Player_A >>> 你好'), 'chat');
  bot.emit('message', msg('你将在 3 秒后被传送,请不要移动…'), 'system');
  bot.emit('resourcePack', 'http://example.invalid/pack', 'hash');
  const s = obs.snapshot();
  assert.equal(s.teleportRequests[0].accept, '/tpaccept Player_A');
  assert.equal(s.recentPlayerChat[0].text, '你好');
  assert.equal(s.teleportWarmup.seconds, 3);
  assert.equal(accepted, 1); assert.equal(s.resourcePack.accepted, 1);
  assert.equal(JSON.stringify(s).includes('example.invalid'), false, 'pack URL/token is never retained');
  bot.emit('end');
  bot.emit('resourcePack'); assert.equal(accepted, 1);
});
