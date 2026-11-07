import { zhEntity } from './names.ts';

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
export type IdentityEntity = { uuid?: string; name?: string; type?: string; username?: string };
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

/** Use only where the caller already has an allowed entity observation. */
export function observedEntityLabel(bot: object, entity: IdentityEntity): string {
  return observedEntityIdentity(bot, entity)?.label
    ?? (entity.type === 'player' || entity.name === 'player' ? entity.username ?? '玩家' : zhEntity(entity.name ?? 'unknown'));
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
