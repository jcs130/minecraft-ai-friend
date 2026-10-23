import { describe, expect, it } from 'vitest';
import { Vec3 } from 'vec3';
import { renderChecks, type CheckWorld } from '../core/check.ts';
import { observationView } from '../core/perception-sight.ts';

describe('check unknown observations', () => {
  it('keeps the occupied support and tested front cells distinct, including successful assertions', () => {
    const world: CheckWorld = { position: () => [49.7, 90, 149.7],
      cell: (x, y, z) => x === 49 && y === 89 && z === 149 ? { state: 'netherrack', solid: true }
        : x === 51 ? null : { state: 'air', solid: false },
      inventory: () => new Map(), site: () => null, mark: () => null };
    const result = renderChecks([
      { ok: true, assert: { kind: 'at', at: [49, 89, 149], is: 'netherrack' } },
      { ok: true, assert: { kind: 'at', at: [50, 89, 150], is: 'netherrack' } },
      { ok: true, assert: { kind: 'at', at: [51, 89, 150], is: 'netherrack' } },
    ], world);
    expect(result).toContain('当前脚格 (49, 90, 149)');
    expect(result).toContain('#1 符合：');
    expect(result).toContain('(49, 89, 149)');
    expect(result).toContain('下界岩');
    expect(result).toContain('#2 (50, 89, 150)');
    expect(result).toContain('现在是空气');
    expect(result).toContain('#3 (51, 89, 150) 尚未观察');
    expect(result).not.toContain('全是空');
  });
  it('reports an all-matching air query as named cells and floors negative feet coordinates', () => {
    const world: CheckWorld = { position: () => [-.1, 64.5, -439.5],
      cell: () => ({ state: 'air', solid: false }), inventory: () => new Map(), site: () => null, mark: () => null };
    const result = renderChecks([{ ok: true, assert: { kind: 'at', at: [0, 64, 0], is: 'air' } }], world);
    expect(result).toContain('当前脚格 (-1, 64, -440)');
    expect(result).toContain('#1 符合：');
    expect(result).toContain('(0, 64, 0)');
  });
  it('keeps an occluded but loaded cell unknown without diagnosing an unloaded chunk', () => {
    const bot = { entity: { id: 1, position: new Vec3(.5, 64, .5), yaw: 0, pitch: 0 },
      blockAt: (p: Vec3) => p.z === -2 || p.z === -5
        ? { name: p.z === -2 ? 'stone' : 'farmland', shapes: [[0, 0, 0, 1, 1, 1]], position: p }
        : { name: 'air', shapes: [], position: p } };
    expect(bot.blockAt(new Vec3(0, 64, -5)).name).toBe('farmland');
    const view = observationView(bot as never);
    const world: CheckWorld = { cell: (x, y, z) => {
      const b = view.blockAt(new Vec3(x, y, z)); return b ? { state: b.name, solid: false } : null;
    }, inventory: () => new Map(), site: () => null, mark: () => null };
    const result = renderChecks([{ ok: true, assert: { kind: 'at', at: [0, 64, -5], is: 'air' } }], world);
    expect(result).toContain('0 条符合、1 条未验证');
    expect(result).toContain('遮挡');
    expect(result).not.toContain('区块没加载');
    expect(result).not.toContain('现在是耕地');
  });
  it('does not label an unknown count or another dimension as a chunk-loading problem', () => {
    const world: CheckWorld = { cell: () => null, inventory: () => new Map(), site: () => null,
      mark: () => ({ name: 'home', kind: 'bed', dimension: 'the_nether', pos: [0, 64, 0], verdict: 'other-dimension', found: null }) };
    const result = renderChecks([
      { ok: true, assert: { kind: 'all', box: { min: [0, 64, 0], max: [0, 64, 0] }, is: 'air' } },
      { ok: true, assert: { kind: 'mark', name: 'home' } },
    ], world);
    expect(result).toContain('2 条未验证');
    expect(result).toContain('格未观察');
    expect(result).toContain('别的维度');
    expect(result).not.toContain('没加载');
  });
});
