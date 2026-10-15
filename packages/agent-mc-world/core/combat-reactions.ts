/** Physically checked short moves and policy-scoped engagement candidates. */
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { Battlefield } from './battlefield.ts';
import type { CombatCandidate, CombatExecutionPolicy } from './combat-decision-types.ts';
import { corridorSafe } from './idle-actions.ts';

export function combatReactions(bot: Bot, field: Battlefield, cfg: CombatExecutionPolicy,
  control: { bodyFree: boolean; canStep: boolean; targetId: number | null; sinceHitMs: number | null;
    fight: string; fleeHealth: number; chaseMax: number; trackingTargets?: ReadonlySet<number>;
    retreatAvailable?: boolean }, programmable = false): CombatCandidate[] {
  if (field.action.emergency) return [];
  const hostiles = field.actors.filter(e => e.relation === 'hostile' && e.health.current !== 0
    && e.entityId !== null && e.lineOfSight === true && e.distance !== null);
  const partyIds = new Set([field.self.entityId, ...field.actors.filter(e => e.relation === 'ally'
    && e.health.current !== 0 && e.entityId !== null).map(e => e.entityId!)]);
  const target = hostiles.find(e => e.entityId === control.targetId) ?? hostiles[0];
  if (!target) return [];
  if (field.action.tracking && !control.bodyFree) return []; // A newly queued task must not wait behind renewed tracking leases.
  const candidates: CombatCandidate[] = [];
  // Spacing/withdrawal are useful BEFORE the first hit, including while the planner thinks.
  if (cfg.allowMovement && (control.bodyFree || field.action.fighting || field.action.tracking)) {
    if (control.retreatAvailable !== false)
      candidates.push({ id: 'retreat', kind: 'retreat', intent: 'Move away from visible danger now without starting an attack; keep retreating using the body controller.' });
    const trackable = hostiles.filter(e => !control.trackingTargets || control.trackingTargets.has(e.entityId!));
    const tracked = trackable.find(e => e.entityId === control.targetId) ?? trackable[0];
    if (tracked?.position && tracked.distance! <= control.chaseMax + 4)
      candidates.push({ id: `track_${tracked.entityId}`, kind: 'track', targetId: tracked.entityId!, uuid: tracked.uuid,
        minDistance: 5, maxDistance: 8, leaseMs: 4000,
        intent: 'Follow this visible hostile at 5–8 blocks without attacking; maintain that distance continuously while the planner thinks. Stop on lost sight or unsafe ground.' });
  }
  if (cfg.allowEngage && control.bodyFree && control.fight !== 'off'
    && (field.self.health.current ?? 0) >= control.fleeHealth + 3) {
    const enemies = hostiles.filter(e => e.distance! <= control.chaseMax
      && (cfg.engageScope === 'hostile' || (e.relationSource === 'server'
        && e.targetEntityId !== null && partyIds.has(e.targetEntityId))));
    for (const enemy of programmable ? enemies : enemies.slice(0, 1))
      candidates.push({ id: `engage_${enemy.entityId}`, kind: 'engage', targetId: enemy.entityId!, uuid: enemy.uuid,
        intent: `Engage visible ${enemy.type ?? 'hostile'} #${enemy.entityId} at ${enemy.distance} blocks using the existing attack controller. Continue attacking and approaching without waiting for the main model.` });
  }
  if (!cfg.allowMovement || !field.action.fighting || !control.canStep || target.position === null
    || (!programmable && (control.sinceHitMs ?? 0) < cfg.movementStallMs)) return candidates;
  const p = bot.entity.position, [x, , z] = target.position;
  const dx = x - p.x, dz = z - p.z, len = Math.hypot(dx, dz);
  if (len < 0.01) return candidates;
  const dirs = programmable ? Array.from({ length: 8 }, (_, i) => ({ x: Math.cos(i * Math.PI / 4),
    z: Math.sin(i * Math.PI / 4), id: `direction_${i}`, intent: 'Take a collision-checked short step while continuing the current attack.' })) : target.distance! > 4
    ? [{ x: dx / len, z: dz / len, id: 'approach', intent: 'Take a verified short step toward the visible enemy to get into attack range.' },
      { x: -dz / len, z: dx / len, id: 'side', intent: 'Take a verified short side step to change the approach angle, continuing attacks.' }]
    : [{ x: -dz / len, z: dx / len, id: 'side', intent: 'Take a verified short side step around the enemy, continuing attacks.' },
      { x: -dx / len, z: -dz / len, id: 'back', intent: 'Take a verified short step away from the enemy to gain space, continuing attacks.' }];
  for (const d of dirs) {
    const to = new Vec3(p.x + d.x * 1.2, p.y, p.z + d.z * 1.2);
    if (corridorSafe(bot, p, to)) candidates.push({ id: `step_${d.id}`, kind: 'step',
      intent: d.intent, destination: [to.x, to.y, to.z] });
  }
  return candidates;
}
