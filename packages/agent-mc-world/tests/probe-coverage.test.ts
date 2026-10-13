import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import type { SkillContext } from '../core/skill-context.ts';
import { skillProbe } from '../core/skills-gather.ts';

const require = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = require('minecraft-data')('1.20.6');

function terrain(unknownX?: number) {
  const bot = {
    registry, entities: {}, game: { dimension: 'overworld' },
    entity: { position: new Vec3(0, 119, 0) },
    blockAt(point: Vec3) {
      const position = point.floored();
      if (position.x === unknownX) return null;
      // A real peak beside the requested line must remain outside its coverage.
      const name = position.x === 20 && position.z === 1 ? 'stone' : 'air';
      return { name, position, boundingBox: name === 'air' ? 'empty' : 'block',
        getProperties: () => ({}) };
    },
  } as unknown as Bot;
  const ctx = { aborted: () => false, probeMemo: { last: null, entries: new Map() } } as SkillContext;
  return { bot, ctx };
}

describe('line probe coverage', () => {
  it('keeps an empty long line scoped to its sampled endpoints, not the surrounding radius', async () => {
    const { bot, ctx } = terrain();
    const receipt = await skillProbe(bot, {
      skill: 'probe', shape: 'line', anchors: [[0, 120, 0], [80, 120, 0]],
    }, ctx);
    expect(receipt).toContain('共 81 格');
    expect(receipt).toContain('(0, 120, 0)→(80, 120, 0)');
    expect(receipt).toContain('线外/线间未测');
    expect(receipt).toContain('不能据此排除整层或半径内地形');
    expect(receipt).not.toContain('石头');
  });

  it('retains coverage when an unchanged line is returned from the probe memo', async () => {
    const { bot, ctx } = terrain();
    const call: Parameters<typeof skillProbe>[1] = {
      skill: 'probe', shape: 'line', anchors: [[0, 120, 0], [2, 120, 0]],
    };
    await skillProbe(bot, call, ctx);
    const receipt = await skillProbe(bot, call, ctx);
    expect(receipt).toContain('与上次探查相同');
    expect(receipt).toContain('(0, 120, 0)→(2, 120, 0)');
    expect(receipt).toContain('线外/线间未测');
  });

  it('retains unmeasured and unloaded limits in a filtered negative result', async () => {
    const { bot, ctx } = terrain(1);
    const receipt = await skillProbe(bot, {
      skill: 'probe', shape: 'line', anchors: [[0, 120, 0], [2, 120, 0]], where: ['stone'],
    }, ctx);
    expect(receipt).toContain('1 格区块没加载');
    expect(receipt).toContain('(0, 120, 0)→(2, 120, 0)');
    expect(receipt).toContain('线外/线间未测');
  });
});
