/** Bounded, read-only tactical cues derived from the bot's actual path and attack packets. */
export type ViewerPoint = { x: number; y: number; z: number };
export type ViewerRoute = { points: ViewerPoint[]; goal: ViewerPoint | null; status: string };

function point(value: unknown): ViewerPoint | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (!['x', 'y', 'z'].every(axis => typeof p[axis] === 'number'
    && Number.isFinite(p[axis]) && Math.abs(p[axis]) <= 30_000_000)) return null;
  return { x: p.x as number, y: p.y as number, z: p.z as number };
}

export function viewerGoal(value: unknown): ViewerPoint | null {
  if (!value || typeof value !== 'object') return null;
  const goal = value as { entity?: { position?: unknown } };
  return point(goal.entity?.position) ?? point(value);
}

export function viewerRoute(result: unknown, origin: unknown, goal: unknown): ViewerRoute {
  const data = result && typeof result === 'object' ? result as { path?: unknown; status?: unknown } : {};
  const start = point(origin);
  const points: ViewerPoint[] = start ? [start] : [];
  for (const raw of Array.isArray(data.path) ? data.path.slice(0, 72) : []) {
    const next = point(raw);
    if (!next) continue;
    const last = points.at(-1);
    if (last && Math.hypot(next.x - last.x, next.z - last.z) < 0.15
      && Math.abs(next.y - last.y) < 0.15) continue;
    points.push(next);
    if (points.length >= 64) break;
  }
  return { points, goal: viewerGoal(goal),
    status: typeof data.status === 'string' ? data.status.slice(0, 24) : 'active' };
}
