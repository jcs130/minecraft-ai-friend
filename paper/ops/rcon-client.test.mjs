import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeSelectorRanges, command } from './rcon-client.mjs';

test('world-sized spatial diagnostics fail before credentials or a socket are opened', () => {
  for (const selector of ['distance=0..60000000', 'distance=6e7', 'distance=..6000', 'dx=6000', 'dy=-512', 'dz=1e6']) {
    const text = `minecraft:execute if entity @e[type=enderman,${selector}]`;
    assert.throws(() => command(text, 1, { properties: 'nonexistent-fixture.properties' }), /Unsafe spatial selector/);
  }
});

test('bounded local queries, loaded-entity censuses and far-away coordinates stay available', () => {
  for (const text of ['execute if entity @e[type=enderman]', 'execute if entity @e[distance=0..64]', 'execute if entity @e[distance=..256]', 'execute if entity @e[distance=32..]', 'execute if entity @e[x=6000000,z=-6000000,dx=32,dy=32,dz=-32]', 'data get entity LittleFish0510 SelectedItem']) assert.doesNotThrow(() => assertSafeSelectorRanges(text));
});
