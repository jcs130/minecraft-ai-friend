import { describe, expect, it } from 'vitest';
import { acceptBlueprint } from '../core/blueprint-plan.ts';
import { reviewBlueprintRailway } from '../src/blueprint-railway.ts';
import type { NormalizedBlueprint } from '../core/blueprint.ts';

const rock = 'minecraft:cobblestone', rail = 'minecraft:rail[shape=north_south]';
const plan = (layers: string[][][]): NormalizedBlueprint => ({
  size_xyz: [layers[0][0].length, layers.length, layers[0].length], site_mode: 'retrofit', layers,
});
function submit(p: NormalizedBlueprint) {
  const palette = [...new Set(p.layers.flat(2))];
  return acceptBlueprint({ ...p, axis_order: 'YZX', palette,
    layers: p.layers.map(l => l.map(r => r.map(s => palette.indexOf(s)))) });
}

describe('rail design review before acceptance', () => {
  it.each(['rail', 'powered_rail', 'detector_rail', 'activator_rail'])(
    'rejects %s stacked on rail even when each state exists in the registry', name => {
      const p = plan([[[rock]], [[rail]], [[`minecraft:${name}[shape=north_south]`]]]);
      const result = submit(p);
      expect(result.ok).toBe(false);
      expect(result.failures).toContainEqual(expect.objectContaining({ path: 'layers[2][0][0]',
        reason: expect.stringContaining('不能承托铁轨') }));
    });
  it('accepts supported but disconnected zigzag cells with explicit design-only topology evidence', () => {
    const p = plan(Array.from({ length: 14 }, (_, y) => [y < 7 ? [rock, rock] : y % 2 ? [rail, rock] : [rock, rail]]));
    const result = submit(p);
    expect(result.ok).toBe(true);
    const reason = result.plan!.advisories.map(a => a.reason).join('\n');
    expect(reason).toContain('7 个图内连通分量');
    expect(reason).toContain('不是当前世界读数');
    expect(reason).toContain('独立股道');
  });
  it('preserves a supported slope and does not certify a passenger journey', () => {
    const result = reviewBlueprintRailway(plan([
      [[rock, rock]], [['minecraft:rail[shape=ascending_east]', rock]],
      [['minecraft:structure_void', 'minecraft:rail[shape=east_west]']],
    ]));
    expect(result.failures).toEqual([]);
    expect(result.advisories.some(a => a.reason.includes('1 个图内连通分量'))).toBe(true);
    expect(result.advisories.some(a => a.reason.includes('再试乘'))).toBe(true);
  });
  it('distinguishes explicitly empty support from unobserved retrofit support', () => {
    expect(submit(plan([[['minecraft:air']], [[rail]]])).ok).toBe(false);
    const unknown = reviewBlueprintRailway(plan([[['minecraft:structure_void']], [[rail]]]));
    expect(unknown.failures).toEqual([]);
    expect(unknown.advisories.some(a => a.reason.includes('现场支撑未知'))).toBe(true);
    expect(reviewBlueprintRailway(plan([[[rail]]])).advisories.some(a => a.reason.includes('现场支撑未知'))).toBe(true);
  });
  it('keeps over-budget topology unverified and leaves non-rail structures alone', () => {
    const large = reviewBlueprintRailway(plan([Array.from({length: 65}, () => Array(65).fill(rail))]));
    expect(large.advisories.some(a => a.reason.includes('连通性未验证'))).toBe(true);
    expect(reviewBlueprintRailway(plan([[[rock]]]))).toEqual({ failures: [], advisories: [] });
  });
});
