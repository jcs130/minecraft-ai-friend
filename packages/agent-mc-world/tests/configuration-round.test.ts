import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { installConfigurationRoundCleanup, installConfigurationPhaseGuard, configurationTransportReady } from '../src/client/index.ts';
const require = createRequire(import.meta.url);
const play = createRequire(require.resolve('mineflayer'))('minecraft-protocol/src/client/play.js');

class ProtocolClient extends EventEmitter {
  version = '1.21.1'; writes: string[] = []; private current = 'login';
  get state() { return this.current; }
  set state(next: string) { const previous = this.current; this.current = next; this.emit('state', next, previous); }
  write(name: string) { this.writes.push(name); }
}

it('the actual protocol plugin replies once after a lobby omits known packs and the backend requests them', () => {
  const client = new ProtocolClient(); play(client, {});
  const dispose = installConfigurationRoundCleanup(client);
  client.emit('success', { uuid: '11111111-1111-1111-1111-111111111111', username: 'ProtocolTest' });
  client.emit('finish_configuration', {});
  expect(client.listenerCount('select_known_packs')).toBe(0);
  for (let round = 0; round < 3; round++) {
    client.emit('start_configuration', {}); client.emit('select_known_packs', { packs: [] }); client.emit('finish_configuration', {});
  }
  expect(client.writes.filter(name => name === 'select_known_packs')).toHaveLength(3);
  expect(client.listenerCount('select_known_packs')).toBe(0);
  expect(client.listenerCount('code_of_conduct')).toBe(0);
  dispose(); expect(client.listenerCount('state')).toBe(0);
});

it('cleanup preserves persistent observers and pre-existing one-shot listeners and releases its own hooks on disconnect', () => {
  const client = new ProtocolClient(), persistent = () => {}, existing = () => {};
  client.on('select_known_packs', persistent); client.once('select_known_packs', existing);
  installConfigurationRoundCleanup(client); client.state = 'configuration';
  client.once('select_known_packs', () => {}); client.emit('finish_configuration');
  expect(client.listeners('select_known_packs')).toEqual([persistent, existing]);
  client.emit('end'); expect(client.listenerCount('state')).toBe(0); expect(client.listenerCount('finish_configuration')).toBe(0);
});

it('physics and position writes stay suspended until the backend supplies a fresh PLAY position', () => {
  const client = new ProtocolClient(), bot = { _client: client, physicsEnabled: true };
  play(client, {}); const originalWrite = client.write;
  const dispose = installConfigurationPhaseGuard(bot);
  client.emit('success', { uuid: '11111111-1111-1111-1111-111111111111', username: 'ProtocolTest' });
  client.write('position'); client.emit('finish_configuration'); client.write('flying');
  expect(bot.physicsEnabled).toBe(false); expect(configurationTransportReady(client)).toBe(false);
  expect(client.writes).not.toContain('position'); expect(client.writes).not.toContain('flying');
  client.emit('position', { x: 0, y: 64, z: 0 });
  expect(bot.physicsEnabled).toBe(true); expect(configurationTransportReady(client)).toBe(true);
  client.write('position'); expect(client.writes.filter(n => n === 'position')).toHaveLength(1);
  client.emit('start_configuration'); client.write('position_look'); client.emit('select_known_packs', { packs: [] });
  expect(client.writes.filter(n => n === 'select_known_packs')).toHaveLength(1);
  expect(client.writes).not.toContain('position_look'); expect(bot.physicsEnabled).toBe(false);
  client.emit('finish_configuration'); client.emit('position', { x: 10, y: 66, z: 10 });
  expect(bot.physicsEnabled).toBe(true); expect(configurationTransportReady(client)).toBe(true);
  dispose(); expect(client.write).toBe(originalWrite); expect(client.listenerCount('state')).toBe(0);
});

it('a caller that disabled physics stays disabled after configuration', () => {
  const client = new ProtocolClient(), bot = { _client: client, physicsEnabled: false };
  const dispose = installConfigurationPhaseGuard(bot); client.state = 'configuration'; client.state = 'play'; client.emit('position', {});
  expect(bot.physicsEnabled).toBe(false); dispose();
});
