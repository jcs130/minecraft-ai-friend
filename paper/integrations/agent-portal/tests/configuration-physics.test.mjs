import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {pauseDuringConfiguration} from '../skill/assets/runtime/qiandengji/configuration.mjs';
import {installConfigurationPhaseGuard, configurationTransportReady} from '../../../../packages/agent-mc-world/core/configuration-round.ts';

function fixture(physicsEnabled) {
  const sent = [], client = Object.assign(new EventEmitter(), {state: 'play', write: name => sent.push(name)});
  const bot = Object.assign(new EventEmitter(), {_client: client, physicsEnabled});
  const state = next => {client.state = next; client.emit('state', next);};
  return {bot, client, sent, state};
}

for (const physics of [true, false]) for (const order of ['core-first', 'adapter-first']) {
  test(`configuration preserves the actual physics owner (${physics}, ${order})`, () => {
    const f = fixture(physics);
    let core, adapter;
    if (order === 'core-first') {core = installConfigurationPhaseGuard(f.bot); adapter = pauseDuringConfiguration(f.bot);}
    else {adapter = pauseDuringConfiguration(f.bot); core = installConfigurationPhaseGuard(f.bot);}
    for (let round = 0; round < 3; round++) {
      f.state('configuration');
      assert.equal(f.bot.physicsEnabled, false);
      for (const packet of ['position', 'flying', 'entity_action']) f.client.write(packet);
      f.state('play');
      for (const packet of ['position', 'flying', 'entity_action']) f.client.write(packet);
      assert.equal(configurationTransportReady(f.client), false);
      assert.deepEqual(f.sent, []);
      f.client.emit('position', {});
      assert.equal(f.bot.physicsEnabled, physics);
      assert.equal(configurationTransportReady(f.client), true);
    }
    f.client.write('position'); assert.deepEqual(f.sent, ['position']);
    adapter.close(); core();
    assert.equal(f.client.listenerCount('state'), 0);
  });
}

test('physics may change between configuration rounds without the adapter overriding it', () => {
  const f = fixture(true), core = installConfigurationPhaseGuard(f.bot), adapter = pauseDuringConfiguration(f.bot);
  for (const enabled of [true, false, true]) {
    f.bot.physicsEnabled = enabled;
    f.state('configuration'); f.state('play'); f.client.emit('position', {});
    assert.equal(f.bot.physicsEnabled, enabled);
  }
  adapter.close(); core();
});

test('adapter cleanup during a transfer never revives physics or sends discarded movement', () => {
  const f = fixture(true), core = installConfigurationPhaseGuard(f.bot), adapter = pauseDuringConfiguration(f.bot);
  f.state('configuration'); f.client.write('position'); adapter.close();
  assert.equal(f.bot.physicsEnabled, false);
  f.client.emit('position', {}); assert.equal(f.bot.physicsEnabled, false);
  f.state('play'); f.client.emit('position', {});
  assert.equal(f.bot.physicsEnabled, true); assert.deepEqual(f.sent, []);
  core();
});

test('the compatibility filter never assumes ownership of an intentionally paused body', () => {
  const f = fixture(false), adapter = pauseDuringConfiguration(f.bot);
  assert.equal(pauseDuringConfiguration(f.bot), adapter);
  f.state('configuration'); f.state('play'); f.client.emit('position', {});
  assert.equal(f.bot.physicsEnabled, false);
  f.bot.emit('end'); f.client.write('position'); assert.deepEqual(f.sent, ['position']);
});
