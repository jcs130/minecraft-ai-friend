import Ajv from 'ajv';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { SCOUT_STEP_SCHEMA, SKILL_STEP_SCHEMA, parseScoutSteps, readSkillHelp } from '../core/skills.ts';
import { observeSpatial, parseSpatialObservation } from '../core/spatial-observation.ts';

describe('public collision ray contract', () => {
  it.each([SKILL_STEP_SCHEMA, SCOUT_STEP_SCHEMA])('advertises the exact parser tuple bounds', schema => {
    const validate = new Ajv({ strict: false }).compile(schema);
    for (const ray of [[0, 0, 24], [90, 180, 64], [-90, -180, 0.1]]) {
      const step = { skill: 'observe', mode: 'rays', rays: [ray] };
      expect(validate(step)).toBe(true);
      expect(parseSpatialObservation(step)).not.toHaveProperty('error');
      expect(parseScoutSteps([step])).not.toHaveProperty('error');
    }
    for (const ray of [[0, 270, 24], [0, -181, 24], [91, 0, 24], [-91, 0, 24], [0, 0, 0], [0, 0, 65]]) {
      const step = { skill: 'observe', mode: 'rays', rays: [ray] };
      expect(validate(step), JSON.stringify(ray)).toBe(false);
      expect(parseSpatialObservation(step)).toHaveProperty('error');
    }
  });

  it('documents offsets from the execution-time body orientation, with matching signs', () => {
    const help = readSkillHelp({ skill: 'observe' });
    expect(help).toHaveProperty('text');
    if (!('text' in help)) throw new Error('Missing observe help');
    expect(help.text).toContain('pitch ±90、yaw ±180');
    expect(help.text).toContain('yaw=0 沿当前朝向');
    expect(help.text).not.toContain('yaw=0 朝北');
    const bot = { entity: { position: new Vec3(0, 64, 0), yaw: Math.PI / 2, pitch: Math.PI / 6 },
      game: { dimension: 'overworld' }, entities: {},
      blockAt: () => ({ name: 'air', stateId: 0, shapes: [], getProperties: () => ({}) }) } as unknown as Bot;
    const result = observeSpatial(bot, { mode: 'rays', rays: [[0, 0, 1], [0, 90, 1], [30, 0, 1]] });
    if (result.kind !== 'rays') throw new Error('Missing ray observation');
    [[-0.866025, 0.5, 0], [0, 0.5, 0.866025], [-0.5, 0.866025, 0]].forEach((expected, index) =>
      expected.forEach((value, axis) => expect(result.rays[index].direction[axis]).toBeCloseTo(value, 6)));
  });
});
