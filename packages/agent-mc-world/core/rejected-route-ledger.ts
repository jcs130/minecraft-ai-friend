import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { SkillCall } from './executor.ts';

const HOLD_MS = 15 * 60_000;
const MAX_RECORDS = 8;
const ORIGIN_RETRY_DISTANCE = 4;

export type RejectedRouteScope = {
  realm: string;
  dimension: string;
  origin: [number, number, number];
};

type RejectedRoute = { key: string; steps: SkillCall[]; scope: RejectedRouteScope; atMs: number };

function validScope(value: unknown): value is RejectedRouteScope {
  if (!value || typeof value !== 'object') return false;
  const scope = value as Partial<RejectedRouteScope>;
  return typeof scope.realm === 'string' && scope.realm.length > 0 && scope.realm.length <= 500
    && typeof scope.dimension === 'string' && scope.dimension.length > 0 && scope.dimension.length <= 100
    && Array.isArray(scope.origin) && scope.origin.length === 3
    && scope.origin.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function sameWorld(a: RejectedRouteScope, b: RejectedRouteScope): boolean {
  return a.realm === b.realm && a.dimension === b.dimension;
}

/** 出发位置改变后，目的地相同也不代表走的是旧路线。 */
export function sameRejectedRouteOrigin(a: RejectedRouteScope | null, b: RejectedRouteScope | null): boolean {
  return !!a && !!b && sameWorld(a, b)
    && Math.hypot(...a.origin.map((n, i) => n - b.origin[i]!)) < ORIGIN_RETRY_DISTANCE;
}

function absolutePoint(step: SkillCall): [number, number, number] | null {
  if (!('at' in step)) return null;
  const at = step.at;
  return Array.isArray(at) && at.length === 3
    && at.every((n: unknown) => typeof n === 'number' && Number.isFinite(n))
    ? at as [number, number, number] : null;
}

function sameWaterShaft(key: string, steps: readonly SkillCall[]): boolean {
  const cell = /^shaft-liquid:(-?\d+):(-?\d+):(-?\d+):(水|岩浆)$/.exec(key);
  if (!cell) return false;
  const [, sx, sy, sz] = cell;
  const [x, y, z] = [Number(sx), Number(sy), Number(sz)];
  const goto = steps.find((step) => step.skill === 'goto');
  const start = goto && absolutePoint(goto);
  if (!start || Math.hypot(start[0] - x, start[2] - z) > 4 || start[1] < y || start[1] > y + 10) return false;
  return steps.some((step) => step.skill === 'tunnel' && Array.isArray(step.at)
    && step.at.length === 3 && typeof step.at[1] === 'string'
    && /^~-\d+$/.test(step.at[1]) && start[1] + Number(step.at[1].slice(1)) <= y);
}

/** 只保存已经连续拒收且触发脱困的路线，重载 World 后也不把它当新路线再跑一遍。 */
export class RejectedRouteLedger {
  private records: RejectedRoute[] = [];

  constructor(private readonly path: string | null, now = Date.now()) {
    if (!path || !existsSync(path)) return;
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || !('records' in parsed)
        || !Array.isArray(parsed.records)) return;
      const version = 'version' in parsed ? parsed.version : undefined;
      // v1 did not record a world or origin. Retire these transient holds instead
      // of inventing provenance or continuing to block every route to a target.
      if (version === 1 || version === undefined) {
        this.persist();
        return;
      }
      if (version !== 2) return;
      this.records = parsed.records.filter((row: unknown): row is RejectedRoute => {
        if (!row || typeof row !== 'object') return false;
        const r = row as Partial<RejectedRoute>;
        return typeof r.key === 'string' && r.key.length <= 200
          && Array.isArray(r.steps) && r.steps.length <= 16
          && validScope(r.scope)
          && typeof r.atMs === 'number' && Number.isFinite(r.atMs)
          && r.atMs <= now && now - r.atMs < HOLD_MS;
      }).slice(-MAX_RECORDS);
    } catch { /* corrupt or older ledger: keep running with an empty guard */ }
  }

  match(steps: readonly SkillCall[], scope: RejectedRouteScope | null, now = Date.now()): string | null {
    if (!validScope(scope)) return null;
    const signature = JSON.stringify(steps);
    return this.records.find((r) => r.atMs <= now && now - r.atMs < HOLD_MS && sameWorld(r.scope, scope)
      && ((sameRejectedRouteOrigin(r.scope, scope) && JSON.stringify(r.steps) === signature)
        // A measured liquid cell remains a local hazard even when approached
        // from another origin, but never carries into another world/dimension.
        || sameWaterShaft(r.key, steps)))?.key ?? null;
  }

  record(key: string, steps: readonly SkillCall[], scope: RejectedRouteScope | null, now = Date.now()): void {
    if (!validScope(scope)) return;
    this.records = this.records.filter((r) => now - r.atMs < HOLD_MS
      && !(r.key === key && sameRejectedRouteOrigin(r.scope, scope)));
    this.records.push({ key, steps: [...steps], scope: { ...scope, origin: [...scope.origin] }, atMs: now });
    this.records = this.records.slice(-MAX_RECORDS);
    this.persist();
  }

  private persist(): void {
    if (this.path) {
      try { writeFileSync(this.path, JSON.stringify({ version: 2, records: this.records })); }
      catch { /* no persistence available; current process still guards the route */ }
    }
  }
}
