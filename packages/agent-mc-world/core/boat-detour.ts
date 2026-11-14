export interface BoatPoint { x: number; y: number; z: number }

/** A small, same-surface detour; not a claim that an entire waterway is open.
 * Every edge is checked by the same hull/water probe used during execution.
 * Search is capped at 8 blocks plus a 3-block forward check and yields no
 * partial speculative path when it cannot establish a safe local rejoin.
 */
export function boatDetour(start: BoatPoint, goal: BoatPoint,
  clear: (from: BoatPoint, to: BoatPoint) => boolean): BoatPoint[] | null {
  const spacing = .5, radius = 8, limit = 768;
  const distance = (p: BoatPoint) => Math.hypot(goal.x - p.x, goal.z - p.z);
  const initial = distance(start);
  if (!Number.isFinite(initial) || initial < 2.5) return null;
  type Node = { p: BoatPoint; ix: number; iz: number; g: number; parent: Node | null };
  const first: Node = { p: { ...start }, ix: 0, iz: 0, g: 0, parent: null };
  const open: Node[] = [first], best = new Map<string, number>([['0,0', 0]]);
  for (let expanded = 0; open.length && expanded < limit; expanded++) {
    open.sort((a, b) => a.g + distance(a.p) - b.g - distance(b.p));
    const n = open.shift()!;
    if (n.g !== best.get(`${n.ix},${n.iz}`)) continue;
    const d = distance(n.p);
    // Rejoin the original heading only after measurable progress AND a checked
    // clear forward segment. Lateral/brief reverse edges are allowed en route.
    const ahead = d > 0 ? { x: n.p.x + (goal.x - n.p.x) / d * Math.min(3, d),
      y: start.y, z: n.p.z + (goal.z - n.p.z) / d * Math.min(3, d) } : n.p;
    if (n.parent && (d <= 2.5 || (initial - d >= 2 && clear(n.p, ahead)))) {
      const path: BoatPoint[] = [];
      for (let p: Node | null = n; p?.parent; p = p.parent) path.push(p.p);
      return path.reverse();
    }
    for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const ix = n.ix + dx, iz = n.iz + dz;
      if (Math.hypot(ix * spacing, iz * spacing) > radius) continue;
      const key = `${ix},${iz}`, g = n.g + spacing;
      if (g >= (best.get(key) ?? Infinity)) continue;
      const p = { x: start.x + ix * spacing, y: start.y, z: start.z + iz * spacing };
      if (!clear(n.p, p)) continue;
      best.set(key, g); open.push({ p, ix, iz, g, parent: n });
    }
  }
  return null;
}
