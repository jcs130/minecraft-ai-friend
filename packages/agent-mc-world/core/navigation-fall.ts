import type { Bot } from 'mineflayer';
import type { Movements } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';

export type FallMode = 'survivable' | 'safe';
export interface NavigationFallBudget {
  mode: FallMode;
  health: number | null;
  reserveHealth: number;
  damageBudget: number;
  maxDropDown: number;
  safeFallDistance: number;
  damageMultiplier: number;
  estimate: 'vanilla-unmitigated';
}
type FallBody = Partial<Pick<Bot, 'health' | 'entity'>>;
const modes = new WeakMap<object, () => FallMode>();
const installed = new WeakSet<object>();
function fallParameters(bot: FallBody): { safeFallDistance: number; damageMultiplier: number } {
  const read = (name: string, fallback: number) => {
    const attributes = (bot.entity as unknown as { attributes?: Record<string, { value: number; modifiers?: Array<{operation:number;amount:number}> }> })?.attributes ?? {};
    const a = attributes[`minecraft:generic.${name}`] ?? attributes[`minecraft:${name}`] ?? attributes[`generic.${name}`];
    if (!a || !Number.isFinite(a.value)) return fallback;
    let base = a.value;
    for (const m of a.modifiers ?? []) if (m.operation === 0 && Number.isFinite(m.amount)) base += m.amount;
    let value = base;
    for (const m of a.modifiers ?? []) if (m.operation === 1 && Number.isFinite(m.amount)) value += base * m.amount;
    for (const m of a.modifiers ?? []) if (m.operation === 2 && Number.isFinite(m.amount)) value *= 1 + m.amount;
    return Number.isFinite(value) ? value : fallback;
  };
  // Account for received adverse attributes; do not spend temporary reductions.
  return { safeFallDistance: Math.max(0, Math.min(3, read('safe_fall_distance', 3))),
    damageMultiplier: Math.max(1, read('fall_damage_multiplier', 1)) };
}
/** HP, not hearts. Do not spend absorption, regeneration, armour or an unverified plugin benefit. */
export function navigationFallBudget(bot: FallBody, mode = modes.get(bot)?.() ?? 'survivable'): NavigationFallBudget {
  const health = typeof bot.health === 'number' && Number.isFinite(bot.health) && bot.health > 0 ? bot.health : null;
  const reserveHealth = 2;
  const damageBudget = mode === 'safe' || health === null ? 0 : Math.max(0, Math.floor(health - reserveHealth));
  const params = fallParameters(bot);
  return { mode, health, reserveHealth, damageBudget, ...params,
    maxDropDown: params.safeFallDistance + damageBudget / params.damageMultiplier, estimate: 'vanilla-unmitigated' };
}
/** Ordinary Java fall estimate. Server damage rules remain authoritative. */
export function estimateFallDamage(drop: number, bot: FallBody = {}): number {
  const p = fallParameters(bot);
  return Number.isFinite(drop) ? Math.max(0, Math.ceil((drop - p.safeFallDistance) * p.damageMultiplier - 1e-6)) : Infinity;
}
export function setNavigationFallMode(bot: object, mode: () => FallMode): void { modes.set(bot, mode); }

type Cell = { x: number; y: number; z: number };
type Move = Cell & { hash: string; cost: number; parkour?: boolean; toBreak?: unknown[]; toPlace?: unknown[]; fallDamage?: number };
type Block = { position?: Vec3; physical: boolean; safe: boolean; liquid: boolean; height: number; name?: string };
type RiskMovements = {
  maxDropDown: number;
  getBlock(p: Cell, x: number, y: number, z: number): Block;
  getLandingBlock(p: Cell, dir: { x: number; z: number }): Block | null;
  getNeighbors(p: Move): Move[];
};

/** Install on this profile only; live navigation and read-only probes use the same policy.
 * The upstream solid-floor test measures to the *block bottom* (one too far),
 * whereas liquid drops measure to feet. Here maxDropDown always means feet height.
 */
export function installNavigationFallCosts(bot: Bot, movements: Movements): void {
  if (installed.has(movements)) return;
  installed.add(movements);
  const m = movements as unknown as RiskMovements;
  let explicitLimit = Infinity;
  Object.defineProperty(m, 'maxDropDown', { configurable: true,
    get: () => Math.min(explicitLimit, navigationFallBudget(bot).maxDropDown),
    set: (limit: number) => { explicitLimit = Number.isFinite(limit) ? Math.max(0, limit) : Infinity; },
  });
  m.getLandingBlock = function (node, dir) {
    let block = this.getBlock(node, dir.x, -2, dir.z);
    const game = bot.game as typeof bot.game & { minY?: number };
    const minY = typeof game?.minY === 'number' && Number.isFinite(game.minY) ? game.minY : -64;
    while (block.position && block.position.y >= minY && node.y - block.position.y <= this.maxDropDown + 1) {
      if (block.liquid && block.safe) return node.y - block.position.y <= this.maxDropDown ? block : null;
      if (block.physical) {
        const landing = this.getBlock(block.position, 0, 1, 0), head = this.getBlock(block.position, 0, 2, 0);
        if (!landing.position || !head.position || !landing.safe || !head.safe) return null;
        return node.y - block.height <= this.maxDropDown ? landing : null;
      }
      if (!block.safe) return null;
      block = this.getBlock(block.position, 0, -1, 0);
    }
    return null;
  };
  const neighbors = m.getNeighbors;
  m.getNeighbors = function (node) {
    const budget = navigationFallBudget(bot), spent = node.fallDamage ?? 0;
    return neighbors.call(this, node).filter(next => {
      // Integer node heights overestimate falls onto slabs, rather than crediting
      // unobserved mitigation. A parkour launch can add ordinary jump height.
      const damage = estimateFallDamage(node.y - next.y + (next.parkour ? 1.25 : 0), bot);
      const total = spent + damage;
      if (total > budget.damageBudget) return false;
      next.fallDamage = total;
      // A cheaper route that spent more health must not hide a survivable route
      // to the same cell. The remaining damage budget is part of A* state.
      if (total > 0) next.hash += `|fall:${total}`;
      // Equal distance favours a staircase; a long detour can lose to a small drop.
      next.cost += damage * (4 + 8 / Math.max(1, (budget.health ?? 2) - total));
      return true;
    });
  };
}

/** Recheck loaded support and the entire vertical body corridor at execution time.
 * Do not certify air, thin walls, hazards, waterlogged solids, or unloaded blocks.
 */
export function verifiedDryLanding(bot: Pick<Bot, 'blockAt'>, from: Cell, to: Cell): boolean {
  const x = Math.floor(to.x), z = Math.floor(to.z);
  const floor = bot.blockAt(new Vec3(x, Math.ceil(to.y) - 1, z), false);
  if (!floor || !floor.shapes?.length || ['magma_block', 'cactus', 'campfire', 'soul_campfire', 'powder_snow'].includes(floor.name)) return false;
  const support = floor.shapes.some(s => s[0] <= .2 && s[3] >= .8 && s[2] <= .2 && s[5] >= .8
    && Math.abs(floor.position.y + s[4] - to.y) < .02);
  if (!support) return false;
  for (let y = Math.floor(to.y); y <= Math.floor(from.y + 1.8); y++) {
    const block = bot.blockAt(new Vec3(x, y, z), false);
    if (!block || /^(?:lava|fire|soul_fire|sweet_berry_bush|powder_snow)$/.test(block.name)) return false;
    if (block.shapes?.some(s => s[3] > .2 && s[0] < .8 && s[5] > .2 && s[2] < .8
      && y + s[4] > to.y + .02 && y + s[1] < from.y + 1.8)) return false;
  }
  return true;
}

type ApprovedDrop = { from: Cell; to: Cell; goal: unknown; damage: number; finishingAt?: number };
const approved = new WeakMap<object, ApprovedDrop>();
export function approveNavigationDrop(bot: Bot, from: Cell, to: Cell): void {
  approved.set(bot, { from: { ...from }, to: { ...to }, goal: bot.pathfinder?.goal,
    damage: estimateFallDamage(from.y - to.y + (bot.controlState?.jump ? 1.25 : 0), bot) });
}
// Pathfinder announces arrival slightly above the floor, then clears its goal.
// Only that matching arrival may finish its last physical descent. A cancelled
// route or new goal never inherits the exemption.
export function finishNavigationDrop(bot: Bot, goal: unknown): void {
  const plan = approved.get(bot), pos = bot.entity?.position;
  if (!plan || plan.goal !== goal || !pos || Math.abs(pos.y - plan.to.y) > 1
    || Math.hypot(pos.x - plan.to.x, pos.z - plan.to.z) > .6
    || !hasApprovedNavigationDrop(bot)) return;
  plan.finishingAt = Date.now();
}
export function clearNavigationDrop(bot: object, preserveArrival = false): void {
  const plan = approved.get(bot);
  if (preserveArrival && plan?.finishingAt !== undefined && Date.now() - plan.finishingAt < 1000) return;
  approved.delete(bot);
}
/** An explicit, still owned and freshly verified landing; lower goal Y alone is insufficient. */
export function hasApprovedNavigationDrop(bot: Bot, peak?: number): boolean {
  const plan = approved.get(bot), pos = bot.entity?.position;
  if (!plan || !pos || plan.goal == null) return false;
  const finishing = bot.pathfinder?.goal == null && plan.finishingAt !== undefined && Date.now() - plan.finishingAt < 1000;
  if (bot.pathfinder?.goal !== plan.goal && !finishing) return false;
  if (peak !== undefined && Math.abs(peak - plan.from.y) > 1.5) return false;
  if (pos.y < plan.to.y - .2 || pos.y > plan.from.y + 1.5 || Math.hypot(pos.x - plan.to.x, pos.z - plan.to.z) > 1.6) return false;
  const budget = navigationFallBudget(bot), landed = bot.entity.onGround && Math.abs(pos.y - plan.to.y) < .1;
  return (landed ? (budget.health ?? 0) >= budget.reserveHealth : plan.damage <= budget.damageBudget)
    && verifiedDryLanding(bot, plan.from, plan.to);
}
