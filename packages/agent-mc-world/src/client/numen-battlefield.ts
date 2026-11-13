import type { Battlefield, BattlefieldActor } from '../../core/battlefield.ts';
import type { CombatCandidate, CombatDecisionFrame } from '../../core/combat-decision-types.ts';

export interface NumenBattlefieldSample {
  sampledAt: number;
  dimension: string;
  selfId: number;
  health: number;
  maxHealth: number;
  food: number;
  position: [number, number, number];
  heldItem: string;
  threats: Array<{ id: number; uuid: string; type: string; reference: string;
    health: number; maxHealth: number; distance: number; targetingSelf: boolean }>;
}

const resource = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const entityId = (id: number) => Number.isSafeInteger(id) && id > 0;
const reading = (health: number, max: number) => Number.isFinite(health) && health > 0
  && Number.isFinite(max) && max >= health;

/** Map the authenticated native observation to the shared, read-only combat ranking frame. */
export function numenCombatFrame(sample: NumenBattlefieldSample | null, generation: number,
  now = Date.now()): CombatDecisionFrame | null {
  if (!sample || !Number.isSafeInteger(sample.sampledAt) || Math.abs(now - sample.sampledAt) > 2000
    || !Number.isSafeInteger(generation) || generation < 1 || !entityId(sample.selfId)
    || !reading(sample.health, sample.maxHealth) || sample.health <= 4
    || !Number.isInteger(sample.food) || sample.food < 0 || sample.food > 20
    || typeof sample.dimension !== 'string' || sample.dimension.length > 120 || !resource.test(sample.dimension)
    || typeof sample.heldItem !== 'string' || sample.heldItem.length > 120 || !resource.test(sample.heldItem)
    || !Array.isArray(sample.position) || sample.position.length !== 3 || !sample.position.every(Number.isFinite)
    || !Array.isArray(sample.threats) || sample.threats.length < 1 || sample.threats.length > 6) return null;

  const health = (current: number, max: number) =>
    ({ current, max, source: 'server' as const, updatedAtMs: sample.sampledAt });
  const ids = new Set([sample.selfId]), uuids = new Set<string>();
  const actors: BattlefieldActor[] = [];
  for (const threat of sample.threats) {
    if (!threat || !entityId(threat.id) || ids.has(threat.id) || typeof threat.uuid !== 'string'
      || !uuid.test(threat.uuid) || uuids.has(threat.uuid) || typeof threat.type !== 'string'
      || threat.type.length > 120 || !resource.test(threat.type)
      || threat.reference !== `${threat.type.split(':')[1]}@${threat.uuid.slice(0, 6)}`
      || !reading(threat.health, threat.maxHealth) || !Number.isFinite(threat.distance)
      || threat.distance < 0 || threat.distance > 16 || typeof threat.targetingSelf !== 'boolean') return null;
    ids.add(threat.id);
    uuids.add(threat.uuid);
    actors.push({ entityId: threat.id, uuid: threat.uuid, type: threat.type, name: null,
      nativeReference: threat.reference, relation: 'hostile', relationSource: 'server', scoreboardTeam: null,
      health: health(threat.health, threat.maxHealth), position: null, distance: threat.distance,
      lineOfSight: true, targetEntityId: threat.targetingSelf ? sample.selfId : null });
  }
  const nearest = sample.threats[0]!;
  const target = { targetId: nearest.id, uuid: nearest.uuid };
  const candidates: CombatCandidate[] = [
    { id: `engage:${nearest.id}`, kind: 'engage', ...target,
      intent: 'Recommend engaging this visible threat with the native combat tool, subject to the owner and game permissions.' },
    { id: `track:${nearest.id}`, kind: 'track', ...target, minDistance: 4, maxDistance: 16, leaseMs: 4000,
      intent: 'Recommend observing this threat without attacking. This does not advance combat.' },
  ];
  const battlefield: Battlefield = { sampledAtMs: sample.sampledAt, connectionGeneration: generation,
    dimension: sample.dimension, self: { entityId: sample.selfId, health: health(sample.health, sample.maxHealth),
      food: sample.food, position: sample.position, scoreboardTeam: null,
      equipment: { held: sample.heldItem, armor: null } },
    action: { fighting: false, emergency: false, taskId: null, step: null, canStep: false },
    actors, omitted: 0, server: null };
  return { battlefield, tacticRevision: 1, mana: null, skills: [], candidates, omittedCandidates: 0 };
}
