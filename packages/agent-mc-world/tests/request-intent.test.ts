import { expect, it } from 'vitest';
import { minecraftRequestKinds, omitRejectedMinecraftSpeech } from '../core/request-intent.ts';

it('classifies actual batch contents and treats commands, camera motion and ignored dryRun as actions', () => {
  expect(minecraftRequestKinds([{ skill: 'chat', text: 'hello' }, { skill: 'chat', text: '/w 玩家_甲 hello' }])).toEqual({ kinds: ['speech'], unknown: 0 });
  expect(minecraftRequestKinds([{ skill: 'observe' }, { skill: 'probe' }, { skill: 'goto', dryRun: true }])).toEqual({ kinds: ['read'], unknown: 0 });
  expect(minecraftRequestKinds([{ skill: 'chat', text: '/mycli status' }, { skill: 'look' }, { skill: 'attack', dryRun: true }])).toEqual({ kinds: ['action'], unknown: 0 });
  expect(minecraftRequestKinds([{ skill: 'eat' }, { skill: 'chat', text: 'plan' }, { skill: 'observe' }])).toEqual({ kinds: ['action', 'speech', 'read'], unknown: 0 });
  expect(minecraftRequestKinds([{ skill: 'invented' }])).toEqual({ kinds: [], unknown: 1 });
  expect(minecraftRequestKinds({})).toBeNull();
});

it('keeps independent meals and movement, preserving original fields and relative step order', () => {
  const batch = [{ skill: 'eat', item: 'bread' }, { skill: 'chat', text: 'unsupported' },
    { skill: 'goto', at: ['~2', '~', '~'], needs: [1] }, { skill: 'equip', item: 'iron_sword', needs: [] }];
  const original = structuredClone(batch), result = omitRejectedMinecraftSpeech(batch, [1]);
  expect(result).toEqual({ supported: true, steps: [batch[0], batch[2], batch[3]], kept: [0, 2, 3], omitted: [1], dependent: [] });
  expect(batch).toEqual(original);
});

it('cuts transitive explicit dependencies and renumbers retained dependencies without guessing social consent', () => {
  const batch = [{ skill: 'chat', text: 'Please agree' }, { skill: 'goto', at: [1, 64, 0], needs: [1] },
    { skill: 'collect', block: 'oak_log', count: 1, needs: [2] }, { skill: 'chat', text: '/mycli status', needs: [] },
    { skill: 'craft', item: 'stick', count: 1, needs: [4] }];
  expect(omitRejectedMinecraftSpeech(batch, [0])).toMatchObject({ supported: true, kept: [3, 4], dependent: [1, 2],
    steps: [{ skill: 'chat', text: '/mycli status', needs: [] }, { skill: 'craft', needs: [1] }] });
});

it('does not drop server commands, accept unknown operations or repair invalid dependencies into executable work', () => {
  for (const batch of [[{ skill: 'chat', text: '/mycli dungeon start' }],
    [{ skill: 'chat', text: 'hello' }, { skill: 'unknown' }],
    [{ skill: 'chat', text: 'hello' }, { skill: 'eat', item: 'bread', needs: [3] }]]) {
    expect(omitRejectedMinecraftSpeech(batch, [0])).toHaveProperty('supported', false);
  }
  expect(omitRejectedMinecraftSpeech([{ skill: 'chat', text: 'hello' }], [0])).toEqual({ supported: true, steps: [], kept: [], omitted: [0], dependent: [] });
});
