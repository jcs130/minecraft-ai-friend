import '../core/dependency-patches.ts';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const mfRequire = createRequire(require.resolve('mineflayer'));
const injectGame = mfRequire('./lib/plugins/game.js') as (bot: unknown, options: unknown) => void;

function commands(version: string, reason: number | string, gameMode: number): unknown[] {
  const written: unknown[] = [];
  const registry = mfRequire('minecraft-data')(version);
  const client = Object.assign(new EventEmitter(), {
    registerChannel() {},
    write(name: string, params: unknown) { if (name === 'client_command') written.push(params); },
  });
  const bot = Object.assign(new EventEmitter(), {
    _client: client, registry,
    supportFeature: (name: string) => registry.supportFeature(name),
  });
  injectGame(bot, {});
  client.emit('game_state_change', { reason, gameMode });
  return written;
}

describe.each(['1.21.1', '1.20.6', '1.8.9'])('End exit acknowledgement on %s', version => {
  it.each([4, 'win_game'] as const)('acknowledges both credit states for reason %s', reason => {
    const registry = mfRequire('minecraft-data')(version);
    const expected = registry.supportFeature('respawnIsPayload') ? { payload: 0 } : { actionId: 0 };
    expect(commands(version, reason, 0)).toEqual([expected]);
    expect(commands(version, reason, 1)).toEqual([expected]);
  });

  it('does not acknowledge an unrelated game-mode change', () => {
    expect(commands(version, 3, 1)).toEqual([]);
    expect(commands(version, 'change_game_mode', 0)).toEqual([]);
  });
});
