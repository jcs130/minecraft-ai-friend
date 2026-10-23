/** Read-only sequential flight geometry and time budgeting from one observed origin. */
import type { Bot } from 'mineflayer';
import { resolveAnchors } from './geometry.ts';
import { flightState, MAX_FLIGHT_DISTANCE, previewFlight, type FlightPreview } from './flight.ts';
import { SkillBlocked } from './skill-context.ts';
import { parseScoutSteps, type MarkLookup, type SkillCall } from './skills.ts';

type FlightStep = Extract<SkillCall, { skill: 'flight' }>;
export const FLIGHT_PLAN_MAX_POINTS = 16;
export const FLIGHT_PLAN_MAX_LEGS = 64;

export function parseFlightPlan(args: Record<string, unknown>, marks?: MarkLookup):
  { steps: FlightStep[]; budgetMs?: number; subdivide?: boolean } | { error: string } {
  if (!Array.isArray(args.points) || !args.points.length || args.points.length > FLIGHT_PLAN_MAX_POINTS) {
    return { error: `points 需要 1 至 ${FLIGHT_PLAN_MAX_POINTS} 个依次到达的飞行目标` };
  }
  if (args.budgetMs !== undefined && (!Number.isSafeInteger(args.budgetMs) || Number(args.budgetMs) <= 0)) {
    return { error: 'budgetMs 需要正整数毫秒；它是调用者提供的可用时长，不是服务端授予权限' };
  }
  if (args.subdivide !== undefined && typeof args.subdivide !== 'boolean') return { error: 'subdivide 需要布尔值' };
  for (const point of args.points) {
    if (!point || typeof point !== 'object' || Array.isArray(point)
      || Object.keys(point).some(key => key !== 'at' && key !== 'land')
      || ('land' in point && typeof point.land !== 'boolean')) return { error: '每个 point 只包含 at 和可选的布尔值 land' };
  }
  const parsed = parseScoutSteps(args.points.map(point => ({ ...point, skill: 'flight' })), marks);
  if ('error' in parsed) return parsed;
  return { steps: parsed.steps as FlightStep[], ...(args.budgetMs === undefined ? {} : { budgetMs: Number(args.budgetMs) }),
    ...(args.subdivide === undefined ? {} : { subdivide: args.subdivide }) };
}

export interface FlightPlanPreview {
  sampledAt: string;
  from: FlightPreview['from'];
  segments: FlightPreview[];
  complete: boolean;
  checkedDurationMs: number;
  estimatedDurationMs: number | null;
  budgetMs: number | null;
  budgetSource: 'caller' | 'server-expiry' | 'caller-and-server-expiry' | null;
  fitsBudget: boolean | null;
  endsOnSupport: boolean | null;
  /** Absolute movement steps with dependencies; null when geometry or duration disallows the full route. */
  steps: FlightStep[] | null;
  blockedStep?: number;
  blockedPoint?: number;
  reason?: string;
}

/** Projected endpoints are planning assumptions; the Bot and its permission remain untouched. */
export function previewFlightPlan(bot: Bot, steps: readonly FlightStep[], callerBudgetMs?: number, subdivide = false): FlightPlanPreview {
  if (!bot.entity?.position) throw new SkillBlocked('还没进入世界，不能试算飞行');
  const observed = bot.entity.position;
  let origin = { x: observed.x, y: observed.y, z: observed.z };
  const state = flightState(bot);
  const remaining = state.allowed && state.expiresAtMs !== undefined
    ? Math.max(0, state.expiresAtMs - Date.now()) : null;
  const budgetMs = remaining === null ? callerBudgetMs ?? null
    : callerBudgetMs === undefined ? remaining : Math.min(remaining, callerBudgetMs);
  const budgetSource = remaining === null ? callerBudgetMs === undefined ? null : 'caller'
    : callerBudgetMs === undefined ? 'server-expiry' : 'caller-and-server-expiry';
  const result: FlightPlanPreview = {
    sampledAt: new Date().toISOString(), from: [origin.x, origin.y, origin.z], segments: [],
    complete: false, checkedDurationMs: 0, estimatedDurationMs: null,
    budgetMs, budgetSource, fitsBudget: null, endsOnSupport: null, steps: null,
  };
  const compiled: FlightStep[] = [];
  for (const [index, step] of steps.entries()) {
    try {
      const resolved = resolveAnchors([step.at], {
        x: Math.floor(origin.x), y: Math.floor(origin.y), z: Math.floor(origin.z),
      });
      if (!Array.isArray(resolved)) throw new SkillBlocked(resolved.error);
      const at = resolved[0];
      const target = { x: at.x + 0.5, y: at.y, z: at.z + 0.5 };
      const pointOrigin = origin;
      const distance = Math.hypot(target.x - origin.x, target.y - origin.y, target.z - origin.z);
      // Two rounded endpoints can add at most sqrt(3) blocks to a leg's straight-line distance.
      const legs = subdivide && distance > MAX_FLIGHT_DISTANCE
        ? Math.ceil(distance / (MAX_FLIGHT_DISTANCE - Math.sqrt(3))) : 1;
      if (compiled.length + legs > FLIGHT_PLAN_MAX_LEGS) throw new SkillBlocked(`整段试算最多 ${FLIGHT_PLAN_MAX_LEGS} 段；请缩短目标范围`);
      for (let leg = 1; leg <= legs; leg++) {
        const last = leg === legs;
        const cell = last ? at : {
          x: Math.round(pointOrigin.x + (target.x - pointOrigin.x) * leg / legs - 0.5),
          y: Math.round(pointOrigin.y + (target.y - pointOrigin.y) * leg / legs),
          z: Math.round(pointOrigin.z + (target.z - pointOrigin.z) * leg / legs - 0.5),
        };
        const land = last && step.land !== false;
        const preview = previewFlight(bot, { x: cell.x + 0.5, y: cell.y, z: cell.z + 0.5 }, { land }, origin);
        result.segments.push(preview);
        result.checkedDurationMs += preview.estimatedDurationMs;
        compiled.push({ skill: 'flight', at: [cell.x, cell.y, cell.z], land,
          ...(compiled.length ? { needs: [compiled.length] } : {}) });
        origin = { x: preview.at[0], y: preview.at[1], z: preview.at[2] };
      }
    } catch (error) {
      if (!(error instanceof SkillBlocked)) throw error;
      return { ...result, blockedStep: compiled.length + 1, blockedPoint: index + 1, reason: error.message };
    }
  }
  return { ...result, complete: true, estimatedDurationMs: result.checkedDurationMs,
    fitsBudget: budgetMs === null ? null : result.checkedDurationMs <= budgetMs,
    endsOnSupport: result.segments.at(-1)?.land ?? false,
    steps: budgetMs !== null && result.checkedDurationMs > budgetMs ? null : compiled };
}
