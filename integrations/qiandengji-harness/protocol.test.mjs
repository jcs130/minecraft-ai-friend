import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CHANNELS, decodePacket, observeQiandengji } from './protocol.mjs';

const uuid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const payload = { schemaVersion: 1, mana: { current: 12, max: 22 }, abilities: [{ id: 'starbolt', cooldownRemainingMs: 4200 }] };
const bytes = value => Buffer.from(JSON.stringify(value));
const body = id => { const client = new EventEmitter(); client.sent = [];
  client.write = (name, packet) => client.sent.push({ name, packet }); return { uuid: id, _client: client }; };

test('preserves raw private state, exact cooldown fields and original body', () => {
  assert.deepEqual(decodePacket('mcagent:state', bytes(payload), uuid), payload);
  assert.deepEqual(decodePacket('mcagent:state', bytes({mana:null,skills:null,abilities:null}), uuid), {mana:null,skills:null,abilities:null});
  assert.equal(decodePacket('mcagent:state', bytes({ ...payload, playerUuid: 'other' }), uuid), null);
  assert.equal(decodePacket('mcviewer:state', bytes({ ...payload, viewerSession: {recipientUuid: uuid, playerUuid: 'other'} }), uuid), null);
  assert.equal(decodePacket('mcagent:state', bytes({ ...payload, playerUuid: uuid }), undefined), null);
});

test('uses the real protocol UUID even when Mineflayer has no bot.uuid convenience field', () => {
  const bot = body(undefined); bot._client.uuid = uuid;
  const observer = observeQiandengji(bot);
  bot._client.emit('custom_payload', {channel:'mcviewer:state', data:bytes({...payload, viewerSession:{recipientUuid:uuid,playerUuid:uuid}})});
  assert.equal(observer.snapshot().bodyId, uuid);
  assert.equal(observer.snapshot().states['mcviewer:state'].value.mana.current, 12);
  observer.close();
});
test('rejects oversized, prefixed, malformed, foreign-schema and invalid ability payloads', () => {
  for (const buffer of [Buffer.alloc(16385), Buffer.concat([Buffer.from([0, 20]), bytes(payload)]),
    bytes([]), bytes({ schemaVersion: 2 }), bytes({ mana: { current: null, max: 20 } }),
    bytes({ abilities: Array(25).fill({ id: 'a' }) }), bytes({ skills: [{ id: '../secret' }] }), Buffer.from([0xff])])
    assert.equal(decodePacket('mcagent:state', buffer, uuid), null);
});
test('each observer sees only its own connection and emits only registration', () => {
  const first = body(uuid), second = body('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  const a = observeQiandengji(first, () => '2026-10-22T00:00:00Z'), b = observeQiandengji(second);
  first._client.emit('custom_payload', { channel: 'mcagent:state', data: bytes(payload) });
  assert.equal(a.snapshot().states['mcagent:state'].value.mana.current, 12);
  assert.deepEqual(b.snapshot().states, {});
  assert.equal(first._client.sent.length, 1);
  assert.equal(first._client.sent[0].packet.channel, 'minecraft:register');
  assert.deepEqual(first._client.sent[0].packet.data.toString().split('\0'), CHANNELS);
  a.close(); b.close();
});
test('bounded receipts and disconnect clear state rather than carrying it into another session', () => {
  const bot = body(uuid), observer = observeQiandengji(bot);
  for (let n = 0; n < 50; n++) bot._client.emit('custom_payload', { channel: 'mcagent:protection', data: bytes({ requestId: String(n), result: 'deny' }) });
  assert.deepEqual(observer.snapshot().receipts.map(r => r.value.requestId), ['47', '48', '49']);
  bot._client.emit('end');
  assert.equal(observer.snapshot().available, false);
  assert.deepEqual(observer.snapshot().receipts, []);
  assert.equal(bot._client.listenerCount('custom_payload'), 0);
});
