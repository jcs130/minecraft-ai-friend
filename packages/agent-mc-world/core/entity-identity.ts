import { zhEntity } from './names.ts';
import { minecraftTextComponent } from './text-component.ts';

/** Server-attested semantic identity. Protocol entity type remains unchanged. */
export interface EntityIdentity {
  uuid: string;
  kind: string;
  name: string;
  label: string;
  source: string;
  observedAt: string;
  ownerUuid?: string;
}
export type IdentityEntity = { uuid?: string; name?: string; type?: string; username?: string; metadata?: unknown[] };
export type EntityIdentityResolver = (entity: IdentityEntity) => EntityIdentity | null;
const resolvers = new WeakMap<object, EntityIdentityResolver>();
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const clean = (text: unknown, max: number) => typeof text === 'string'
  ? text.replace(/§[0-9a-fk-or]/gi, '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';

/** Bind only for this bot connection. Old cleanup must not remove a newer binding. */
export function bindEntityIdentityResolver(bot: object, resolver: EntityIdentityResolver): () => void {
  resolvers.set(bot, resolver);
  return () => { if (resolvers.get(bot) === resolver) resolvers.delete(bot); };
}

/** Identity is not visibility, ownership permission, friendliness or proof of life. */
export function observedEntityIdentity(bot: object, entity: IdentityEntity): EntityIdentity | null {
  if (!entity.uuid || !uuid.test(entity.uuid) || entity.type === 'player' || entity.name === 'player') return null;
  const value = resolvers.get(bot)?.(entity);
  if (!value || typeof value.uuid !== 'string' || value.uuid.toLowerCase() !== entity.uuid.toLowerCase()
    || !Number.isFinite(Date.parse(value.observedAt))) return null;
  const kind = clean(value.kind, 64), name = clean(value.name, 160), label = clean(value.label, 200), source = clean(value.source, 128);
  if (!kind || !name || !label || !source) return null;
  return { uuid: entity.uuid, kind, name, label, source, observedAt: value.observedAt,
    ...(value.ownerUuid && uuid.test(value.ownerUuid) ? { ownerUuid: value.ownerUuid } : {}) };
}

/** Received display text, not a verified species, relation or instruction. */
export function entityCustomName(bot: object, entity: IdentityEntity): string | null {
  const keys = (bot as {registry?: {entitiesByName?: Record<string,{metadataKeys?: string[]}>}})
    .registry?.entitiesByName?.[entity.name ?? '']?.metadataKeys ?? [];
  const index = keys.indexOf('custom_name');
  const text = clean(minecraftTextComponent(index >= 0 ? entity.metadata?.[index] : undefined),160);
  return text || null;
}

/** Display text leads; protocol identifiers remain separate execution facts.
 * Never infer a mod identity/ownership/hostility from a custom-name prefix. */
export function entityDisplayLabel(name: string, customName?: string | null, identity?: EntityIdentity | null): string {
  return identity?.label ?? (customName ? `「${customName}」（协议类型：${zhEntity(name)}）` : zhEntity(name));
}

/** Callers must suppress metadata for nearby, non-visible observations. */
export function observedEntityLabel(bot: object, entity: IdentityEntity, includeCustomName = true): string {
  if (entity.type === 'player' || entity.name === 'player') return entity.username ?? '玩家';
  return entityDisplayLabel(entity.name ?? 'unknown',includeCustomName ? entityCustomName(bot,entity) : null,
    observedEntityIdentity(bot, entity));
}

/** Keep display names separate from semantic identity and verified ownership.
 * A name may also be an animal/item noun. Ownership here is a reported relation,
 * never a permission to act, an ally designation, or a life-state assertion. */
export function entityIdentityContext(bot: object, identity: EntityIdentity): string {
  const self = bot as { player?: { uuid?: string }; entity?: { uuid?: string }; _client?: { uuid?: string } };
  const selfUuid = self.player?.uuid ?? self.entity?.uuid ?? self._client?.uuid;
  const relation = identity.ownerUuid && selfUuid && uuid.test(selfUuid)
    ? identity.ownerUuid.toLowerCase() === selfUuid.toLowerCase() ? '归属本人' : '归属其他玩家'
    : '归属未比对';
  return `服务端角色身份=${identity.kind}，${relation}`;
}
