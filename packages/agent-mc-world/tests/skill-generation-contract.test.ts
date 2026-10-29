import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { parseSteps, SCOUT_STEP_SCHEMA, SKILL_STEP_SCHEMA } from '../core/skills.ts';

function generation(schema = SKILL_STEP_SCHEMA) {
  const contracts = schema['x-agent-mc-skill-contracts'] as Record<string, unknown[]>;
  expect(contracts).toBeDefined();
  return new Ajv({ strict: false }).compile({ anyOf: Object.values(contracts).flat() });
}

describe('opt-in per-skill generation contracts from the native registry', () => {
  it('requires an explicit take quantity or the separate whole-container alternative', () => {
    const validate = generation();
    for (const bad of [{ skill: 'take', item: 'iron_sword' },
      { skill: 'take', item: 'iron_sword', count: 1, index: 1 },
      { skill: 'take', all: true }]) {
      expect(validate(bad)).toBe(false);
    }
    for (const good of [{ skill: 'take', item: 'iron_sword', count: 1, at: [1, 64, 0] },
      { skill: 'take', item: 'bread', count: 2, from: 'open' },
      { skill: 'take', all: true, at: [1, 64, 0] }]) {
      expect(validate(good)).toBe(true);
      expect(parseSteps([good])).not.toHaveProperty('error');
    }
  });
  it('rejects the captured missing-coordinate harvest without changing legacy parsing', () => {
    const bad = { skill: 'harvest', block: 'wheat', replant: true, text: 'at', tolerance: 1 };
    expect(new Ajv({ strict: false }).compile(SKILL_STEP_SCHEMA)(bad)).toBe(true);
    expect(generation()(bad)).toBe(false);
    expect(parseSteps([bad])).toHaveProperty('error');
    const good = { skill: 'harvest', block: 'wheat', at: [10, 64, 20], replant: true };
    expect(generation()(good)).toBe(true);
    expect(parseSteps([good])).not.toHaveProperty('error');
    expect(generation()({ ...good, at: [10, 20] })).toBe(false);
    expect(generation()({ ...good, text: 'at' })).toBe(false);
  });

  it.each([
    { skill: 'build', material: 'cherry_planks', temporary: true, fill: 'solid' },
    { skill: 'build', material: 'torch', at: [1, 64, 0], anchors: [[1, 64, 0]] },
    { skill: 'craft', item: 'cherry_planks', grid: [['cherry_log']] },
    { skill: 'craft', count: 1 },
  ])('rejects missing or competing alternatives: %j', step => {
    expect(generation()(step)).toBe(false);
    expect(parseSteps([step])).toHaveProperty('error');
  });

  it.each([
    { skill: 'goto', at: [10, 20] },
    { skill: 'harvest', block: 'wheat', at: ['~', '~-1', '~'], replant: true },
    { skill: 'craft', item: 'cherry_planks', count: 4 },
    { skill: 'craft', grid: [['charcoal'], ['stick']], count: 4 },
    { skill: 'build', material: 'torch', anchors: [[1, 64, 0]] },
    { skill: 'build', material: 'torch', at: [1, 64, 0], temporary: true },
    { skill: 'build', material: 'torch', on: [{ at: [1, 63, 0], face: 'up' }] },
    { skill: 'build', material: 'stone', shape: 'box', anchors: [[1, 64, 0], [2, 65, 1]], fill: 'outline' },
    { skill: 'build', blueprint: 'home-v2', at: [1, 64, 0] },
    { skill: 'build', blueprint: 'home-v2' },
    { skill: 'surface' },
    { skill: 'eat', item: 'bread', needs: [] },
  ])('retains legal native calls: %j', step => {
    expect(generation()(step)).toBe(true);
    expect(parseSteps([step])).not.toHaveProperty('error');
  });

  it('does not expand the scout allowlist or include runtime facts', () => {
    const first = JSON.stringify(SKILL_STEP_SCHEMA);
    const validate = generation(SCOUT_STEP_SCHEMA);
    expect(validate({ skill: 'harvest', block: 'wheat', at: [1, 64, 0] })).toBe(false);
    expect(validate({ skill: 'observe', mode: 'voxels', bounds: [-1, -1, -1, 1, 1, 1] })).toBe(true);
    expect(JSON.stringify(SKILL_STEP_SCHEMA)).toBe(first);
  });
});
