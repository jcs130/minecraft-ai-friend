import { describe, expect, it } from 'vitest';
import { reviewBlueprintDesign } from '../core/blueprint-design.ts';
import { compileBlueprint } from '../core/blueprint-plan.ts';
import type { NormalizedBlueprint } from '../core/blueprint.ts';
const air = 'minecraft:air', stone = 'minecraft:stone';
const plan = (head: string, floor = stone): NormalizedBlueprint => ({ size_xyz: [4,3,4], site_mode: 'retrofit',
  layers: [Array.from({length:4},()=>Array(4).fill(floor)), Array.from({length:4},()=>Array(4).fill(air)),
    Array.from({length:4},()=>Array(4).fill(head))] });
describe('measured design review', () => {
  it('measures low passages with exact slab collision and delivers it through blueprint compilation', () => {
    const p = plan('minecraft:oak_slab[type=top,waterlogged=false]');
    expect(compileBlueprint(p).advisories.some(a => a.reason.includes('16 个') && a.reason.includes('净空不足 1.8'))).toBe(true);
    expect(reviewBlueprintDesign(plan(air)).some(a => a.reason.includes('净空不足'))).toBe(false);
  });
  it('does not pretend unmodified retrofit terrain or a partial floor is measured support', () => {
    for (const floor of ['minecraft:structure_void', 'minecraft:oak_slab[type=bottom,waterlogged=false]']) {
      expect(reviewBlueprintDesign(plan(stone, floor)).some(a => a.reason.includes('净空不足'))).toBe(false);
    }
  });
  it('reports palette and proportions without prescribing a style or scoring beauty', () => {
    const reasons = reviewBlueprintDesign(plan(air)).map(a=>a.reason).join('\n');
    expect(reasons).toContain('X/Z/Y=4/4/3');
    expect(reasons).toContain('minecraft:stone 约 100%');
    expect(reasons).toContain('不自动判差');
    expect(reasons).toContain('不是当前世界读数');
  });
});
