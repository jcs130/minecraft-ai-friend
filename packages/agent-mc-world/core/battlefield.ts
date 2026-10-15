/** Connection-scoped battle facts from native entities and optional server party telemetry. */
import type { Bot } from 'mineflayer';
import { metaOf } from './animal-state.ts';
import { HOSTILE } from './melee.ts';
import { piglinIsHostile } from './piglin.ts';
import { canSeeEntity } from './terrain.ts';
import { observedEntity } from './perception-sight.ts';
import { loadedSight } from './idle-actions.ts';

export const BATTLEFIELD_CHANNEL = 'mcagent:battlefield';
type Relation = 'ally' | 'hostile' | 'neutral' | 'unknown';
type Health = { current: number | null; max: number | null; source: 'native' | 'server' | 'unknown'; updatedAtMs: number | null };
export interface BattlefieldActor {
  entityId: number | null;
  uuid: string | null;
  type: string | null;
  name: string | null;
  relation: Relation;
  relationSource: 'server' | 'hostile-type' | 'unknown';
  scoreboardTeam: string | null;
  health: Health;
  position: [number, number, number] | null;
  distance: number | null;
  lineOfSight: boolean | null;
  targetEntityId: number | null;
}
export interface Battlefield {
  sampledAtMs: number;
  connectionGeneration: number;
  dimension: string | null;
  self: { entityId: number; health: Health; food: number | null; position: [number, number, number]; scoreboardTeam: string | null;
    equipment?: { held: string | null; armor: Array<string | null> | null } };
  action: { fighting: boolean; emergency: boolean; taskId: number | null; step: string | null;
    targetEntityId?: number | null; sinceHitMs?: number | null; canStep?: boolean; followTarget?: string | null;
    tracking?: boolean };
  actors: BattlefieldActor[];
  omitted: number;
  server: { sequence: number; receivedAtMs: number; expiresAtMs: number } | null;
}
interface ServerActor {
  entityId: number | null; uuid: string; type: string | null; name: string | null;
  relation: Relation; health: { current: number | null; max: number | null }; targetEntityId: number | null;
}
interface ServerFrame {
  sequence: number; dimension: string; receivedAtMs: number; expiresAtMs: number; actors: ServerActor[];
}
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const reading = (v: unknown): v is number | null => v === null || number(v);
const entityId = (v: unknown): v is number | null => v === null || (Number.isSafeInteger(v) && (v as number) >= 0);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function serverFrame(data: unknown, now: number): ServerFrame | null {
  if (!Buffer.isBuffer(data) || data.length > 32_768) return null;
  try {
    const v = JSON.parse(data.toString('utf8'));
    if (v?.schemaVersion !== 1 || !Number.isSafeInteger(v.sequence) || v.sequence < 0
      || typeof v.dimension !== 'string' || !v.dimension.length || v.dimension.length > 100
      || !Number.isInteger(v.validForMs) || v.validForMs < 1 || v.validForMs > 5_000
      || !Array.isArray(v.entities) || v.entities.length > 64) return null;
    const identities = new Set<string>();
    const ids = new Set<number>();
    for (const e of v.entities) {
      if (!e || typeof e.uuid !== 'string' || !uuid.test(e.uuid) || identities.has(e.uuid.toLowerCase())
        || !entityId(e.entityId) || (e.entityId !== null && ids.has(e.entityId))
        || !['ally', 'hostile', 'neutral', 'unknown'].includes(e.relation)
        || !(e.type === null || (typeof e.type === 'string' && /^[a-z][a-z0-9_:]{0,63}$/.test(e.type)))
        || !(e.name === null || (typeof e.name === 'string' && e.name.length <= 80))
        || !e.health || !reading(e.health.current) || !reading(e.health.max)
        || (e.health.max !== null && (e.health.max <= 0 || (e.health.current !== null && e.health.current > e.health.max)))
        || !entityId(e.targetEntityId)) return null;
      identities.add(e.uuid.toLowerCase());
      if (e.entityId !== null) ids.add(e.entityId);
    }
    return { sequence: v.sequence, dimension: v.dimension, receivedAtMs: now,
      expiresAtMs: now + v.validForMs, actors: v.entities.map((e: ServerActor) => ({
        entityId: e.entityId, uuid: e.uuid, type: e.type, name: e.name, relation: e.relation,
        health: { current: e.health.current, max: e.health.max }, targetEntityId: e.targetEntityId,
      })) };
  } catch { return null; }
}

/** Attribute values include the server's modifiers; an absent maximum stays unknown. */
function maxHealth(entity: Bot['entity']): number | null {
  const attrs = (entity as unknown as { attributes?: Record<string,
    { value: number; modifiers?: Array<{ amount: number; operation: number }> }> }).attributes;
  const attr = Object.entries(attrs ?? {}).find(([key]) => /(?:^|[.:])max_health$/.test(key))?.[1];
  if (!attr || !number(attr.value)) return null;
  const mods = attr.modifiers ?? [];
  let value = attr.value + mods.filter(m => m.operation === 0).reduce((n, m) => n + m.amount, 0);
  const base = value;
  value += mods.filter(m => m.operation === 1).reduce((n, m) => n + base * m.amount, 0);
  for (const m of mods) if (m.operation === 2) value *= 1 + m.amount;
  return number(value) && value > 0 ? value : null;
}

/** No chat parsing, main-model output or proximity inference establishes party membership. */
export class BattlefieldObserver {
  private bot: Bot | null = null;
  private server: ServerFrame | null = null;
  private sequence = -1;
  private readonly healthTimes = new Map<number, number>();
  private ownHealthAtMs: number | null = null;
  private detach: (() => void) | null = null;

  reset(): void { this.server = null; this.sequence = -1; this.healthTimes.clear(); this.ownHealthAtMs = null; }

  bind(bot: Bot, serverChannel?: string): void {
    if (this.bot === bot) return;
    this.detach?.(); this.reset(); this.bot = bot;
    const metadata = (packet: { entityId: number; metadata?: Array<{ key: number }> }) => {
      const e = bot.entities[packet.entityId];
      const keys = e?.name ? bot.registry.entitiesByName[e.name]?.metadataKeys : undefined;
      if (packet.metadata?.some(m => keys?.[m.key] === 'health')) this.healthTimes.set(packet.entityId, Date.now());
    };
    const health = () => { this.ownHealthAtMs = Date.now(); };
    const gone = (e: Bot['entity']) => {
      this.healthTimes.delete(e.id);
      if (this.server) this.server.actors = this.server.actors.filter(a => a.entityId !== e.id);
    };
    const payload = (packet: { channel?: unknown; data?: unknown }) => {
      if (serverChannel && packet.channel === serverChannel) this.noteServerPayload(packet.data);
    };
    const end = () => { this.reset(); this.detach?.(); this.bot = null; };
    bot._client.on('entity_metadata', metadata);
    bot._client.on('custom_payload', payload);
    bot._client.on('end', end);
    bot.on('health', health); bot.on('entityGone', gone);
    this.detach = () => {
      bot._client.removeListener('entity_metadata', metadata);
      bot._client.removeListener('custom_payload', payload);
      bot._client.removeListener('end', end);
      bot.removeListener('health', health); bot.removeListener('entityGone', gone);
      this.detach = null;
    };
  }

  close(): void { this.detach?.(); this.bot = null; this.reset(); }

  noteServerPayload(data: unknown, now = Date.now()): boolean {
    const frame = serverFrame(data, now);
    if (!frame || frame.sequence <= this.sequence) return false;
    this.sequence = frame.sequence; this.server = frame;
    return true;
  }

  sample(bot: Bot, generation: number, action: Battlefield['action'], maxEntities: number, now = Date.now()): Battlefield {
    const dim = bot.game?.dimension ?? null;
    const dimensionKey = (v: string | null) => v === null ? null : v.includes(':') ? v : `minecraft:${v}`;
    const server = this.server && dimensionKey(this.server.dimension) === dimensionKey(dim)
      && this.server.expiresAtMs > now ? this.server : null;
    const rows = new Map((server?.actors ?? []).map(a => [a.uuid.toLowerCase(), a]));
    const p = bot.entity.position;
    const team = (name: string | undefined) => name ? bot.teamMap?.[name]?.team ?? null : null;
    const actors: BattlefieldActor[] = [];
    for (const e of Object.values(bot.entities ?? {})) {
      if (!e?.position || e === bot.entity || e.id === bot.entity.id || e.isValid === false) continue;
      // Native tracking and party telemetry do not grant visual knowledge through walls.
      if (!observedEntity(bot, e)) continue;
      const distance = Math.hypot(e.position.x - p.x, e.position.y - p.y, e.position.z - p.z);
      if (distance > 24) continue;
      const rawRow = e.uuid ? rows.get(e.uuid.toLowerCase()) : undefined;
      const row = rawRow && (rawRow.entityId === null || rawRow.entityId === e.id) ? rawRow : undefined;
      const hostile = e.type !== 'player' && (HOSTILE.has(e.name ?? '')
        || (e.name === 'piglin' && piglinIsHostile(bot, e)));
      if (!row && !hostile && e.type !== 'player') continue;
      if (row) rows.delete(row.uuid.toLowerCase());
      const native = metaOf(bot, e, 'health');
      let visible: boolean | null = null;
      if (typeof bot.world?.raycast === 'function' && typeof bot.blockAt === 'function') {
        try {
          const to = { x: e.position.x, y: e.position.y + (e.height ?? 1) * 0.5, z: e.position.z };
          if (loadedSight(bot, to)) visible = canSeeEntity(bot, e);
        } catch { /* An unloaded ray is unknown. */ }
      }
      actors.push({ entityId: e.id, uuid: e.uuid ?? null, type: e.name ?? row?.type ?? null,
        name: e.username ?? row?.name ?? null, relation: row?.relation ?? (hostile ? 'hostile' : 'unknown'),
        relationSource: row ? 'server' : hostile ? 'hostile-type' : 'unknown',
        scoreboardTeam: team(e.username),
        health: row ? { ...row.health, source: 'server', updatedAtMs: server!.receivedAtMs }
          : { current: number(native) ? native : null, max: maxHealth(e), source: number(native) ? 'native' : 'unknown',
            updatedAtMs: this.healthTimes.get(e.id) ?? null },
        position: [e.position.x, e.position.y, e.position.z], distance: Math.round(distance * 10) / 10,
        lineOfSight: visible, targetEntityId: row?.targetEntityId ?? null });
    }
    for (const row of rows.values()) {
      if (row.relation !== 'ally' || row.uuid.toLowerCase() === bot.entity.uuid?.toLowerCase()) continue;
      // Party members outside native entity tracking have no measured position or visibility.
      actors.push({ ...row, scoreboardTeam: null, relationSource: 'server',
        health: { ...row.health, source: 'server', updatedAtMs: server!.receivedAtMs },
        position: null, distance: null, lineOfSight: null });
    }
    actors.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity) || (a.entityId ?? 0) - (b.entityId ?? 0));
    return { sampledAtMs: now, connectionGeneration: generation, dimension: dim,
      self: { entityId: bot.entity.id, health: { current: number(bot.health) ? bot.health : null,
        max: maxHealth(bot.entity), source: number(bot.health) ? 'native' : 'unknown', updatedAtMs: this.ownHealthAtMs },
        food: number(bot.food) ? bot.food : null, position: [p.x, p.y, p.z], scoreboardTeam: team(bot.username),
        equipment: { held: bot.heldItem?.name ?? null,
          armor: bot.inventory?.slots ? [5, 6, 7, 8].map(i => bot.inventory.slots[i]?.name ?? null) : null } },
      action, actors: actors.slice(0, maxEntities), omitted: Math.max(0, actors.length - maxEntities),
      server: server ? { sequence: server.sequence, receivedAtMs: server.receivedAtMs, expiresAtMs: server.expiresAtMs } : null };
  }
}
