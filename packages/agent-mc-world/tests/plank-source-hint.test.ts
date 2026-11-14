import { describe, expect, it } from 'vitest';
import { plankSourceHint } from '../core/precheck.ts';

describe('plankSourceHint', () => {
  it('is silent when the bag has no logs', () => {
    expect(plankSourceHint([{ name: 'cobblestone', count: 8 }, { name: 'dirt', count: 4 }])).toBe('');
  });

  it('points at logs already in the bag so the agent crafts matching planks first', () => {
    const hint = plankSourceHint([
      { name: 'spruce_log', count: 30 },
      { name: 'oak_log', count: 8 },
      { name: 'cobblestone', count: 95 },
    ], (n) => n === 'spruce_log' ? '云杉原木' : n === 'oak_log' ? '橡木原木' : n);
    expect(hint).toContain('云杉原木×30');
    expect(hint).toContain('橡木原木×8');
    expect(hint).toContain('可先 craft 成对应木板');
  });
});
