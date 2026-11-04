import type { Move, Movements } from 'mineflayer-pathfinder';

/** Restrict native parkour to a one-cell gap between full, level landing surfaces.
 * Keep the pinned navigator's headroom/liquid checks and execution physics. No
 * climbing onto door frames, long sprint jumps or lower/higher landing guesses.
 */
export function installLevelGapJumps(movements: Movements, mode: 'gap' | 'native' = 'gap'): void {
  type Node = { x: number; y: number; z: number };
  type Internal = Movements & {
    getMoveParkourForward(node: Node, dir: { x: number; z: number }, neighbors: Move[]): void;
    getBlock(node: Node, dx: number, dy: number, dz: number): { physical: boolean; height: number };
    __levelGapJumps?: boolean;
    __gapJumpMode?: 'gap' | 'native';
  };
  const m = movements as Internal;
  m.__gapJumpMode = mode;
  if (m.__levelGapJumps) return;
  m.__levelGapJumps = true;
  const native = m.getMoveParkourForward;
  m.getMoveParkourForward = function (node, direction, neighbors) {
    if (this.__gapJumpMode === 'native') return native.call(this, node, direction, neighbors);
    const start = this.getBlock(node, 0, -1, 0);
    if (!start.physical || Math.abs(start.height - node.y) > 1e-6) return;
    const candidates: Move[] = [];
    native.call(this, node, direction, candidates);
    for (const move of candidates) {
      if (move.y !== node.y || Math.abs(move.x - node.x) + Math.abs(move.z - node.z) !== 2) continue;
      const end = this.getBlock(move, 0, -1, 0);
      if (end.physical && Math.abs(end.height - move.y) < 1e-6) neighbors.push(move);
    }
  };
}
