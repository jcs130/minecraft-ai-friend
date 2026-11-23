import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { installPlayerLoadedAck } from '../core/player-loaded.ts';

function mockBot(options: { feature?: boolean; state?: string } = {}) {
  const writes: string[] = [];
  const client = Object.assign(new EventEmitter(), {
    state: options.state ?? 'play',
    write(name: string) { writes.push(name); },
  });
  const bot = {
    _client: client,
    supportFeature: (name: string) => name === 'sendsPlayerLoadedPacket' && options.feature !== false,
  };
  return { bot, client, writes, dispose: installPlayerLoadedAck(bot) };
}

describe('player_loaded acknowledgement', () => {
  it('writes player_loaded on the first play position even when the server sent no health (NanoLimbo-shaped)', () => {
    const { client, writes, dispose } = mockBot();
    client.emit('position', { x: 0, y: 400, z: 0, teleportId: 1 });
    expect(writes).toEqual(['player_loaded']);
    client.emit('position', { x: 0, y: 400, z: 0, teleportId: 2 });
    expect(writes).toEqual(['player_loaded']);
    dispose();
  });

  it('does not write play-state player_loaded during configuration', () => {
    const { client, writes, dispose } = mockBot({ state: 'configuration' });
    client.emit('position', { x: 0, y: 400, z: 0, teleportId: 1 });
    expect(writes).toEqual([]);
    dispose();
  });

  it('sends again after start_configuration returns the client to a new play session', () => {
    const { client, writes, dispose } = mockBot();
    client.emit('position', { x: 0, y: 400, z: 0, teleportId: 1 });
    client.state = 'configuration';
    client.emit('start_configuration', {});
    client.emit('state', 'configuration');
    client.emit('position', { x: 0, y: 400, z: 0, teleportId: 2 });
    expect(writes).toEqual(['player_loaded']);
    client.state = 'play';
    client.emit('state', 'play');
    client.emit('position', { x: 0.5, y: 65, z: 0.5, teleportId: 3 });
    expect(writes).toEqual(['player_loaded', 'player_loaded']);
    dispose();
  });

  it('does not write the packet on versions that lack the feature (1.21.1-shaped)', () => {
    const { client, writes, dispose } = mockBot({ feature: false });
    client.emit('position', { x: 0, y: 64, z: 0, teleportId: 1 });
    expect(writes).toEqual([]);
    dispose();
  });

  it('is the session owner: mineflayer health.js and the position helper together write only once per play session', () => {
    const { bot, client, writes, dispose } = mockBot();
    // Limbo-shaped: position first, no health.
    client.emit('position', { x: 0, y: 400, z: 0, teleportId: 1 });
    expect(writes).toEqual(['player_loaded']);
    // The same play session later receives health; mineflayer health.js writes again.
    client.write('player_loaded', {});
    expect(writes).toEqual(['player_loaded']);
    // New play session after configuration must still send exactly once.
    client.state = 'configuration';
    client.emit('start_configuration', {});
    client.emit('state', 'configuration');
    client.state = 'play';
    client.emit('state', 'play');
    client.write('player_loaded', {}); // health.js wins the race
    expect(writes).toEqual(['player_loaded', 'player_loaded']);
    client.emit('position', { x: 0.5, y: 65, z: 0.5, teleportId: 3 });
    expect(writes).toEqual(['player_loaded', 'player_loaded']);
    dispose();
  });

  it('does not swallow the first needed write when health.js is the only caller', () => {
    const { client, writes, dispose } = mockBot();
    client.write('player_loaded', {});
    expect(writes).toEqual(['player_loaded']);
    dispose();
  });

  it('drops a configuration-phase player_loaded write from any caller', () => {
    const { client, writes, dispose } = mockBot({ state: 'configuration' });
    client.write('player_loaded', {});
    expect(writes).toEqual([]);
    client.state = 'play';
    client.emit('state', 'play');
    client.emit('position', { x: 0, y: 64, z: 0, teleportId: 1 });
    expect(writes).toEqual(['player_loaded']);
    dispose();
  });
});
