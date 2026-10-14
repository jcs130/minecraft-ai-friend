import { expect, it } from 'vitest';
import type { Bot } from 'mineflayer';
import { viewerSleepState } from '../core/viewer-sleep.ts';

it('uses confirmed sleep and measured bed facing, and clears a stale sleeping pose on wake', () => {
  const bot = { isSleeping: true, registry: { entitiesByName: { player: { metadataKeys: ['pose', 'sleeping_pos'] } } },
    entity: { metadata: [2, { x: -3, y: 64, z: 5 }] },
    blockAt: () => ({ name: 'red_bed', getProperties: () => ({ facing: 'west' }) }) } as unknown as Bot;
  expect(viewerSleepState(bot)).toEqual({ sleeping: true, bedPosition: { x: -3, y: 64, z: 5 }, bedFacing: 'west' });
  bot.isSleeping = false;
  expect(viewerSleepState(bot)).toEqual({ sleeping: false, bedPosition: null, bedFacing: null });
});
it('does not infer a bed or its direction from unknown metadata or nearby blocks', () => {
  const bot = { isSleeping: true, entity: { metadata: [] }, blockAt: () => { throw Error('must not scan'); } } as unknown as Bot;
  expect(viewerSleepState(bot)).toEqual({ sleeping: true, bedPosition: null, bedFacing: null });
});
