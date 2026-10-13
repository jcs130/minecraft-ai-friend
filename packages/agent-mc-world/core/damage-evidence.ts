/** Preserve server damage provenance before Mineflayer reduces it to entityHurt. */
import type { Bot } from 'mineflayer';
import type { HurtSource } from './melee.ts';

type Point = { x: number; y: number; z: number };
type DamagePacket = {
  entityId: number; sourceTypeId: number; sourceCauseId: number;
  sourceDirectId: number; sourcePosition?: Point | null;
};

export interface DamageEvidence {
  origin: 'packet' | 'event';
  sequence: number;
  sourceType: string | null;
  causeId: number | null;
  directId: number | null;
  actor: { id: number; name: string; entity?: HurtSource } | null;
  projectile: boolean;
  sourcePosition: Point | null;
}

interface DamageState {
  listeners: Set<(evidence: DamageEvidence) => void>;
  types: string[];
  sequence: number;
  life: number;
  loss: number;
  health: number | null;
  absorption: number | null;
  pending: Map<string, DamageEvidence>;
  legacy: Array<{ source?: HurtSource }>;
  rawTimer: ReturnType<typeof setTimeout> | null;
  legacyTimer: ReturnType<typeof setTimeout> | null;
  lastRawAt: number;
  rawSeen: Map<string, number>;
}

const states = new WeakMap<Bot, DamageState>();
const LEGACY_PAIR_MS = 25;
const HEALTH_PAIR_MS = 50;
const LIVING_TYPES = new Set(['mob', 'hostile', 'animal', 'passive', 'ambient', 'water_creature', 'player']);
const decodedId = (id: unknown): number | null => Number.isSafeInteger(id) && (id as number) > 0 ? (id as number) - 1 : null;
const point = (value: unknown): Point | null => {
  if (!value || typeof value !== 'object') return null;
  const p = value as Point;
  return [p.x, p.y, p.z].every(Number.isFinite) ? { x: p.x, y: p.y, z: p.z } : null;
};

function entityType(bot: Bot, entity: HurtSource): string | undefined {
  return bot.registry?.entitiesByName?.[entity.name ?? '']?.type ?? entity.type;
}

/** Install during plugin injection so the live server's registry order is retained. */
export function installDamageEvidence(bot: Bot): void {
  if (states.has(bot)) return;
  const state: DamageState = {
    listeners: new Set(), types: [], sequence: 0, life: 0, loss: 0,
    health: Number.isFinite(bot.health) ? bot.health : null, absorption: null, pending: new Map(), legacy: [],
    rawTimer: null, legacyTimer: null, lastRawAt: -Infinity, rawSeen: new Map(),
  };
  states.set(bot, state);
  const dispatch = (evidence: DamageEvidence): void => {
    for (const listener of state.listeners) listener(evidence);
  };
  const flush = (): void => {
    state.rawTimer = null;
    const batch = new Map(state.pending);
    state.pending.clear();
    for (const [key, evidence] of batch) {
      if (state.rawSeen.get(key) === state.loss) continue;
      state.rawSeen.set(key, state.loss);
      if (state.rawSeen.size > 128) state.rawSeen.delete(state.rawSeen.keys().next().value!);
      dispatch(evidence);
    }
  };
  const clearLife = (): void => {
    state.life += 1;
    state.pending.clear();
    state.legacy.length = 0;
    if (state.rawTimer) clearTimeout(state.rawTimer);
    state.rawTimer = null;
    if (state.legacyTimer) clearTimeout(state.legacyTimer);
    state.legacyTimer = null;
    state.rawSeen.clear();
    state.health = null;
    state.absorption = null;
    state.lastRawAt = -Infinity;
  };
  bot.on('death', clearLife);
  bot.on('respawn', clearLife);
  bot.on('end', () => { clearLife(); state.listeners.clear(); });

  bot._client?.on('registry_data', (packet: { id?: string; entries?: Array<{ key: string }> }) => {
    if (packet.id === 'minecraft:damage_type' && Array.isArray(packet.entries)) {
      state.types = packet.entries.map((entry) => entry.key);
    }
  });
  bot._client?.on('update_health', (packet: { health: number }) => {
    if (!Number.isFinite(packet.health)) return;
    if (state.health !== null && packet.health < state.health) state.loss += 1;
    state.health = packet.health;
  });
  bot._client?.on('entity_metadata', (packet: { entityId: number; metadata: Array<{ key: number; value: unknown }> }) => {
    if (packet.entityId !== bot.entity?.id) return;
    const key = bot.registry?.entitiesByName?.player?.metadataKeys?.indexOf('player_absorption');
    if (key === undefined || key < 0) return;
    const value = packet.metadata.find((entry) => entry.key === key)?.value;
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    if (state.absorption !== null && value < state.absorption) state.loss += 1;
    state.absorption = value;
  });
  // This listener runs before the native plugin emits entityHurt for the same packet.
  bot._client?.prependListener('damage_event', (packet: DamagePacket) => {
    if (packet.entityId !== bot.entity?.id) return;
    const causeId = decodedId(packet.sourceCauseId);
    const directId = decodedId(packet.sourceDirectId);
    const cause = causeId === null ? undefined : bot.entities[causeId];
    const direct = directId === null ? undefined : bot.entities[directId];
    const projectile = !!direct && entityType(bot, direct) === 'projectile';
    const directActor = direct?.isValid && LIVING_TYPES.has(entityType(bot, direct) ?? '') ? direct : undefined;
    // A cause ID is authoritative even if its entity has just left the loaded table.
    const actorId = causeId !== bot.entity?.id ? causeId : null;
    const actor = actorId !== null ? { id: actorId, name: cause?.name ?? '伤害来源',
      ...(cause?.isValid && cause.position ? { entity: cause } : {}) }
      : causeId === null && directActor && directActor.id !== bot.entity?.id
        ? { id: directActor.id, name: directActor.name ?? '伤害来源', entity: directActor } : null;
    const sourcePosition = point(packet.sourcePosition) ?? (direct?.position ? point(direct.position) : null);
    const evidence: DamageEvidence = {
      origin: 'packet', sequence: ++state.sequence,
      sourceType: Number.isSafeInteger(packet.sourceTypeId) ? state.types[packet.sourceTypeId] ?? null : null,
      causeId, directId, actor, projectile, sourcePosition,
    };
    state.lastRawAt = Date.now();
    state.legacy.length = 0;
    if (state.legacyTimer) clearTimeout(state.legacyTimer);
    state.legacyTimer = null;
    // Identical packets without any additional authoritative health loss are echoes,
    // not fresh hits. Keep the bound small even when a server supplies changing IDs.
    const key = JSON.stringify([packet.sourceTypeId, causeId, directId, sourcePosition]);
    state.pending.set(key, evidence);
    if (state.pending.size > 128) state.pending.delete(state.pending.keys().next().value!);
    if (!state.rawTimer) {
      const life = state.life;
      // update_health can follow the damage packet in a separate network callback.
      state.rawTimer = setTimeout(() => { if (life === state.life) flush(); }, HEALTH_PAIR_MS);
    }
  });
  bot.on('entityHurt', ((entity: { id: number } | undefined, source?: HurtSource) => {
    if (entity?.id !== bot.entity?.id || Date.now() - state.lastRawAt <= LEGACY_PAIR_MS) return;
    state.legacy.push({ source });
    if (state.legacyTimer) return;
    const life = state.life;
    state.legacyTimer = setTimeout(() => {
      state.legacyTimer = null;
      if (life !== state.life) return;
      const batch = state.legacy.splice(0);
      const ids = new Set<number | null>();
      for (const { source: legacySource } of batch) {
        const source = legacySource?.isValid && legacySource.id !== bot.entity?.id
          && bot.entities[legacySource.id] === legacySource ? legacySource : undefined;
        const id = source?.id ?? null;
        if (ids.has(id)) continue;
        ids.add(id);
        dispatch({ origin: 'event', sequence: ++state.sequence, sourceType: null,
          causeId: id, directId: id,
          actor: source ? { id: source.id, name: source.name ?? '伤害来源', entity: source } : null,
          projectile: false, sourcePosition: source?.position ? point(source.position) : null });
      }
    }, LEGACY_PAIR_MS);
  }) as never);
}

export function observeDamage(bot: Bot, listener: (evidence: DamageEvidence) => void): () => void {
  installDamageEvidence(bot);
  const state = states.get(bot)!;
  state.listeners.add(listener);
  return () => { state.listeners.delete(listener); };
}
