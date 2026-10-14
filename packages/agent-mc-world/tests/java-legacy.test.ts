import { describe, expect, it } from 'vitest';
import { translateJavaLegacy } from '../src/client/java-legacy.ts';
import type { JavaClientState } from '../src/contracts/java-client.ts';
const state = { position: [0, 64, 0], selectedSlot: 2, inventory: [{ slot: 2, name: 'minecraft:bread', count: 3 }] } as unknown as JavaClientState;
describe('native legacy command conversion', () => {
  it('preserves original action ID and rejects unimplemented programs before dispatch', () => {
    expect(translateJavaLegacy({ action_id: 'same', steps: [{ skill: 'chat', text: '/help' }] }, state)).toMatchObject({ action_id: 'same', operation: 'chat', input: { text: '/help' } });
    for (const steps of [[{ skill: 'goto', at: [1, 64, 2] }], [{ skill: 'chat', text: 'x', needs: 0 }], [{ skill: 'chat' }, { skill: 'goto' }]]) expect(() => translateJavaLegacy({ steps }, state)).toThrow('unavailable');
  });
  it('uses native pitch convention and bounded actual key ticks', () => {
    const look = translateJavaLegacy({ steps: [{ skill: 'look', at: [0, 60, 10] }] }, state);
    expect(look.input.pitch).toBeGreaterThan(0);
    expect(translateJavaLegacy({ steps: [{ skill: 'control', keys: ['forward', 'jump'], durationMs: 500 }] }, state)).toMatchObject({ operation: 'move', input: { forward: true, jump: true, ticks: 10 } });
    expect(() => translateJavaLegacy({ steps: [{ skill: 'control', keys: ['forward'], mode: 'flight' }] }, state)).toThrow();
  });
  it('never silently equips another item or offhand and treats eating as use, not a heal proof', () => {
    expect(translateJavaLegacy({ steps: [{ skill: 'equip', item: 'bread' }] }, state)).toMatchObject({ operation: 'hotbar', input: { slot: 2 } });
    expect(translateJavaLegacy({ steps: [{ skill: 'eat', item: 'bread' }] }, state)).toMatchObject({ operation: 'use', input: { ticks: 40 } });
    expect(() => translateJavaLegacy({ steps: [{ skill: 'eat', item: 'bread' }] }, { ...state, selectedSlot: 1 })).toThrow();
    expect(() => translateJavaLegacy({ steps: [{ skill: 'equip', item: 'bread', hand: 'off' }] }, state)).toThrow();
  });
});
