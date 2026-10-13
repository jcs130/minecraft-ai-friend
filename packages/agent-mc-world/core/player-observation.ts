/** PlayerObservations records visible player proximity, movement and pose edges without deciding how to respond. */
import type { Bot } from 'mineflayer';
import { bearing, canSeeEntity, DIRECTION_ZH, type Direction } from './terrain.ts';

export const PLAYER_OBSERVATION_LIMITS = {
  enterRange: 16, exitRange: 24, closeRange: 4, closeExitRange: 6, gestureRange: 6, movementRange: 8,
  movementDistance: 4, movementNoticeMs: 12_000,
  gesturePairMs: 1_800, gestureNoticeMs: 15_000,
  facingAngleDegrees: 20, facingStableMs: 1_000, facingNoticeMs: 15_000,
} as const;

export interface PlayerObservation {
  kind: 'appearance' | 'approach' | 'movement' | 'facing' | 'gesture';
  playerName: string;
  entityId: number;
  distance: number | null;
  visible: boolean;
  direction: Direction | null;
  close: boolean;
  motion?: 'arm_swing' | 'crouch';
  handItemName?: string;
  angularErrorDegrees?: number;
}

interface PlayerState {
  name: string;
  visible: boolean;
  close: boolean;
  lastNoticeAtMs: number;
  lastPosition: { x: number; y: number; z: number };
  movementDistance: number;
  facingSinceMs: number | null;
  facingAnnounced: boolean;
  lastFacingNoticeAtMs: number | null;
}

type ObservationBot = Pick<Bot, 'entity' | 'entities' | 'world'>;
type Entity = Bot['entity'] & { headYaw?: number };
type IgnorePlayer = (name: string) => boolean;

/** Mineflayer yaw zero points north; positive pitch points up. */
export function playerFacingAngle(observer: Entity, player: Entity): number | null {
  const yaw = Number.isFinite(player.headYaw) ? player.headYaw : player.yaw;
  if (!Number.isFinite(yaw) || !Number.isFinite(player.pitch)) return null;
  const dx = observer.position.x - player.position.x;
  const dy = observer.position.y + Math.min(observer.height ?? 1.8, 1.62)
    - player.position.y - Math.min(player.height ?? 1.8, 1.62);
  const dz = observer.position.z - player.position.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 0.25) return null;
  const horizontal = Math.cos(player.pitch);
  const dot = (-Math.sin(yaw!) * horizontal * dx + Math.sin(player.pitch) * dy
    - Math.cos(yaw!) * horizontal * dz) / distance;
  return Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
}

export class PlayerObservations {
  private bot: ObservationBot | null = null;
  private readonly players = new Map<number, PlayerState>();
  private readonly gestures = new Map<string, { name: string; lastAtMs: number; count: number; lastEmitAtMs: number | null }>();

  clear(): void {
    this.players.clear();
    this.gestures.clear();
  }

  forget(entityId: number): void {
    this.players.delete(entityId);
    for (const key of this.gestures.keys()) if (key.startsWith(`${entityId}:`)) this.gestures.delete(key);
  }

  forgetPlayer(name: string): void {
    for (const [id, player] of this.players) if (player.name === name) this.forget(id);
    for (const [key, gesture] of this.gestures) if (gesture.name === name) this.gestures.delete(key);
  }

  private observeBot(bot: ObservationBot): void {
    if (bot === this.bot) return;
    this.clear();
    this.bot = bot;
  }

  sample(bot: ObservationBot, ignore: IgnorePlayer, nowMs = Date.now()): PlayerObservation[] {
    this.observeBot(bot);
    const out: PlayerObservation[] = [];
    const present = new Set<number>();
    const limits = PLAYER_OBSERVATION_LIMITS;
    for (const entity of Object.values(bot.entities)) {
      if (entity === bot.entity || entity.type !== 'player' || entity.isValid === false
        || !Number.isFinite(entity.id) || !entity.position || !entity.username || ignore(entity.username)) continue;
      const id = entity.id;
      const distance = entity.position.distanceTo(bot.entity.position);
      if (distance >= limits.exitRange) { this.forget(id); continue; }
      let previous = this.players.get(id);
      if (previous && previous.name !== entity.username) { this.forget(id); previous = undefined; }
      if (!previous && distance > limits.enterRange) continue;
      present.add(id);
      const visible = canSeeEntity(bot, entity);
      const close = distance <= (previous?.close ? limits.closeExitRange : limits.closeRange);
      const position = { x: entity.position.x, y: entity.position.y, z: entity.position.z };
      const fact = (kind: PlayerObservation['kind']): PlayerObservation => ({ kind,
        playerName: entity.username!, entityId: id, visible, close,
        distance: visible ? Math.round(distance * 10) / 10 : null,
        direction: bearing(position.x - bot.entity.position.x, position.z - bot.entity.position.z) });
      const state: PlayerState = previous ?? { name: entity.username, visible, close,
        lastNoticeAtMs: nowMs, lastPosition: position, movementDistance: 0,
        facingSinceMs: null, facingAnnounced: false, lastFacingNoticeAtMs: null };
      if (!previous) {
        out.push(fact('appearance'));
        this.players.set(id, state);
      } else {
        if (visible && state.visible && distance <= limits.movementRange) {
          state.movementDistance += Math.hypot(position.x - state.lastPosition.x,
            position.y - state.lastPosition.y, position.z - state.lastPosition.z);
        } else state.movementDistance = 0;
        if ((!state.visible && visible) || (!state.close && close)) {
          out.push(fact('approach'));
          state.lastNoticeAtMs = nowMs;
          state.movementDistance = 0;
        } else if (visible && distance <= limits.movementRange
          && nowMs - state.lastNoticeAtMs >= limits.movementNoticeMs
          && state.movementDistance >= limits.movementDistance) {
          out.push(fact('movement'));
          state.lastNoticeAtMs = nowMs;
          state.movementDistance = 0;
        }
        state.visible = visible;
        state.close = close;
        state.lastPosition = position;
      }
      const angle = visible && distance <= limits.gestureRange ? playerFacingAngle(bot.entity, entity) : null;
      if (angle === null || angle > limits.facingAngleDegrees) {
        state.facingSinceMs = null;
        state.facingAnnounced = false;
      } else {
        state.facingSinceMs ??= nowMs;
        if (!state.facingAnnounced && nowMs - state.facingSinceMs >= limits.facingStableMs
          && (state.lastFacingNoticeAtMs === null || nowMs - state.lastFacingNoticeAtMs >= limits.facingNoticeMs)) {
          out.push({ ...fact('facing'), angularErrorDegrees: Math.round(angle * 10) / 10 });
          state.facingAnnounced = true;
          state.lastFacingNoticeAtMs = nowMs;
        }
      }
    }
    for (const id of this.players.keys()) if (!present.has(id)) this.forget(id);
    return out;
  }

  gesture(bot: ObservationBot, entity: Entity, motion: 'wave' | 'crouch', ignore: IgnorePlayer,
    nowMs = Date.now()): PlayerObservation | null {
    this.observeBot(bot);
    const limits = PLAYER_OBSERVATION_LIMITS;
    if (entity === bot.entity || entity.type !== 'player' || entity.isValid === false
      || !Number.isFinite(entity.id) || !entity.position || !entity.username || ignore(entity.username)) return null;
    const distance = entity.position.distanceTo(bot.entity.position);
    if (distance > limits.gestureRange || !canSeeEntity(bot, entity)) return null;
    const key = `${entity.id}:${motion}`;
    for (const [gestureKey, seen] of this.gestures) {
      if (nowMs - seen.lastAtMs > 60_000) this.gestures.delete(gestureKey);
    }
    const stored = this.gestures.get(key);
    const previous = stored?.name === entity.username ? stored : undefined;
    const count = previous && nowMs - previous.lastAtMs <= limits.gesturePairMs ? previous.count + 1 : 1;
    const lastEmitAtMs = previous?.lastEmitAtMs ?? null;
    this.gestures.set(key, { name: entity.username, lastAtMs: nowMs, count, lastEmitAtMs });
    if (count < 2 || (lastEmitAtMs !== null && nowMs - lastEmitAtMs < limits.gestureNoticeMs)) return null;
    this.gestures.set(key, { name: entity.username, lastAtMs: nowMs, count: 0, lastEmitAtMs: nowMs });
    const hand = entity.equipment?.[0];
    return { kind: 'gesture', playerName: entity.username, entityId: entity.id,
      distance: Math.round(distance * 10) / 10, visible: true, close: distance <= limits.closeRange,
      direction: bearing(entity.position.x - bot.entity.position.x, entity.position.z - bot.entity.position.z),
      motion: motion === 'wave' ? 'arm_swing' : 'crouch',
      ...(typeof hand?.name === 'string' ? { handItemName: hand.name } : {}) };
  }
}

/** Structured observation contract consumed outside the World; an armed swing is never a wave. */
export function playerObservationMeta(fact: PlayerObservation): Record<string, unknown> {
  const kind = fact.kind === 'appearance' ? 'entered'
    : fact.kind === 'approach' ? (fact.visible && fact.close ? 'close' : 'visible')
      : fact.kind === 'movement' ? 'moved'
        : fact.kind === 'facing' ? 'looking'
          : fact.motion === 'crouch' ? 'crouch' : fact.handItemName ? 'arm_swing' : 'wave';
  return { ...fact, schemaVersion: 1, kind };
}

export function renderPlayerObservation(fact: PlayerObservation): string {
  const where = fact.direction ? `${DIRECTION_ZH[fact.direction]}边` : '附近';
  const location = `${where}约 ${Math.round(fact.distance ?? 0)} 格`;
  if (!fact.visible) return `玩家 ${fact.playerName} 在附近，${where}方向有遮挡`;
  if (fact.kind === 'gesture') {
    const action = fact.motion === 'crouch' ? '连续蹲起'
      : fact.handItemName ? `手持 ${fact.handItemName} 连续挥动手臂` : '空手连续挥动手臂';
    return `玩家 ${fact.playerName} 在你身边${action}`;
  }
  if (fact.kind === 'facing') return `玩家 ${fact.playerName} 在${location}，头部朝向你所在的方向`;
  if (fact.kind === 'movement') return `玩家 ${fact.playerName} 仍在身边移动，现在在${location}`;
  if (fact.kind === 'approach' && fact.close) return `玩家 ${fact.playerName} 走到身边，在${location}`;
  return `玩家 ${fact.playerName} 在${location}`;
}
