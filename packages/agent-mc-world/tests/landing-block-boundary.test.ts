import '../core/dependency-patches.ts';
import {createRequire} from 'node:module';
import {describe, expect, it} from 'vitest';
import {Movements} from 'mineflayer-pathfinder';
import {Vec3} from 'vec3';

const require = createRequire(import.meta.url);
const nativeRequire = createRequire(require.resolve('mineflayer'));

describe.each(['1.21.1', '1.20.6'])('drop landing boundary on %s', version => {
  function fixture(missingLanding: boolean) {
    const registry = nativeRequire('prismarine-registry')(version);
    const Block = nativeRequire('prismarine-block')(registry);
    const bot = {registry, game: {minY: -64}, entities: {}, inventory: {items: () => []},
      blockAt(p: Vec3) {
        if (missingLanding && p.x === 1 && p.y === 65 && p.z === 0) return null;
        const block = Block.fromStateId(p.y === 64 ? registry.blocksByName.stone.defaultState : 0, 0);
        block.position = p.clone();
        return block;
      }};
    const moves = new Movements(bot as any) as any;
    moves.canDig = false;
    return {moves, node: {x: 0, y: 66, z: 0, remainingBlocks: 0}, dir: new Vec3(1, 0, 0)};
  }

  it('rejects an unloaded landing above known support without crashing the planner', () => {
    const {moves, node, dir} = fixture(true);
    const neighbors: unknown[] = [];
    expect(moves.getLandingBlock(node, dir)).toBeNull();
    expect(() => moves.getMoveDropDown(node, dir, neighbors)).not.toThrow();
    expect(neighbors).toEqual([]);
    // An unknown edge must not poison later queries in the same process.
    const loaded = fixture(false);
    expect(loaded.moves.getLandingBlock(loaded.node, loaded.dir)?.position).toEqual(new Vec3(1, 65, 0));
  });

  it('preserves a loaded drop and the configured maximum drop height', () => {
    const {moves, node, dir} = fixture(false);
    const neighbors: any[] = [];
    moves.getMoveDropDown(node, dir, neighbors);
    expect(neighbors).toHaveLength(1);
    expect([neighbors[0].x, neighbors[0].y, neighbors[0].z]).toEqual([1, 65, 0]);
    moves.maxDropDown = 0;
    expect(moves.getLandingBlock(node, dir)).toBeNull();
  });
});
