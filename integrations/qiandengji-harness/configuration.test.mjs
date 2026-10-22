import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { pauseDuringConfiguration } from './configuration.mjs';

function body(physicsEnabled = true) {
  const bot = new EventEmitter(), client = new EventEmitter(), sent = [];
  bot._client = client; bot.physicsEnabled = physicsEnabled;
  client.state = 'play'; client.write = (name, params) => sent.push({name, params});
  const state = next => { const old = client.state; client.state = next; client.emit('state', next, old); };
  return { bot, client, sent, state };
}
test('proxy reconfiguration discards stale movement while preserving handshake and position acknowledgement', () => {
  const {bot, client, sent, state} = body();
  const fix = pauseDuringConfiguration(bot);
  client.write('configuration_acknowledged', {}); state('configuration');
  assert.equal(bot.physicsEnabled, false);
  for (const name of ['position','position_look','look','flying','entity_action','player_input']) client.write(name, {});
  client.write('settings', {}); client.write('select_known_packs', {packs:[]});
  client.write('keep_alive', {keepAliveId:1n}); client.write('finish_configuration', {});
  state('play'); assert.equal(bot.physicsEnabled, false);
  client.write('teleport_confirm', {teleportId:3}); client.emit('position', {});
  assert.equal(bot.physicsEnabled, true);
  client.write('position', {x:1});
  assert.deepEqual(sent.map(x => x.name), ['configuration_acknowledged','settings','select_known_packs','keep_alive','finish_configuration','teleport_confirm','position']);
  assert.equal(fix.discarded, 6); bot.emit('end');
});
test('disabled physics remains disabled; repeated transitions do not replay movement', () => {
  const {bot, client, sent, state} = body(false);
  const fix = pauseDuringConfiguration(bot);
  assert.equal(pauseDuringConfiguration(bot), fix);
  for (let n=0;n<3;n++) {
    state('configuration'); state('configuration'); client.write('position', {x:n});
    state('play'); client.emit('position', {}); assert.equal(bot.physicsEnabled, false);
  }
  assert.equal(sent.length, 0); assert.equal(fix.discarded, 3);
  fix.close(); fix.close(); assert.equal(client.listenerCount('state'), 0);
  assert.equal(client.listenerCount('position'), 0); assert.equal(bot.listenerCount('end'), 0);
});
test('configuration arriving before physics injection preserves Mineflayer default enabled state', () => {
  const {bot, client, state} = body(); delete bot.physicsEnabled;
  const fix = pauseDuringConfiguration(bot);
  state('configuration'); state('play'); client.emit('position', {});
  assert.equal(bot.physicsEnabled, true); fix.close();
});
