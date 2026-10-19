import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { parseScoutSteps, parseSteps, SCOUT_STEP_SCHEMA, SKILL_STEP_SCHEMA } from '../core/skills.ts';

describe('shared field declarations accept every skill-specific target', () => {
  const validate = new Ajv({ strict: false }).compile(SKILL_STEP_SCHEMA);
  const scout = new Ajv({ strict: false }).compile(SCOUT_STEP_SCHEMA);

  it.each([
    { skill: 'find', target: 'oak_log', direction: 'west', distance: 32 },
    { skill: 'find', target: 'spruce_log', distance: 48 },
    { skill: 'attack', target: 'zombie' },
    { skill: 'use', target: 'villager' },
    { skill: 'ride', target: 'boat' },
    { skill: 'toss', item: 'dirt', count: 1, target: 'ExamplePlayer' },
  ])('does not let the organize target enum reject %j', step => {
    expect(parseSteps([step])).not.toHaveProperty('error');
    expect(validate(step), JSON.stringify(validate.errors)).toBe(true);
  });

  it('does not expand the separate scout skill allowlist', () => {
    const step = { skill: 'find', target: 'oak_log', distance: 32 };
    expect(validate(step)).toBe(true);
    expect(scout(step)).toBe(false);
    expect(parseScoutSteps([step])).toHaveProperty('error');
  });

  it('still rejects invalid per-skill enum values and item quantities', () => {
    expect(parseSteps([{ skill: 'organize', target: 'oak_log', rules: [] }])).toHaveProperty('error');
    expect(parseSteps([{ skill: 'take', item: 'arrow', count: 1, from: 'invented' }])).toHaveProperty('error');
    expect(parseSteps([{ skill: 'take', item: 'arrow', count: 0 }])).toHaveProperty('error');
    expect(validate({ skill: 'take', item: 'arrow', count: 0 })).toBe(false);
    expect(validate({ skill: 'control', mode: 'invented' })).toBe(false);
  });
});
