interface DeathEntity { id: number; uuid?: string }
export interface DeathTargetIdentity { entity: DeathEntity; uuid: string | undefined }
export const captureDeathTarget = (entity: DeathEntity): DeathTargetIdentity => ({ entity, uuid: entity.uuid });
/** A native death can arrive after removal, but numeric ID reuse is not the original entity's death. */
export function matchesDeathTarget(entities: Record<number, DeathEntity> | undefined,
  selected: DeathTargetIdentity, event: number | { id?: number; uuid?: string }): boolean {
  const id = typeof event === 'number' ? event : event.id;
  if (id !== selected.entity.id || selected.entity.uuid !== selected.uuid) return false;
  if (event === selected.entity) return true;
  if (typeof event !== 'number' && typeof event.uuid === 'string')
    return selected.uuid !== undefined && event.uuid === selected.uuid;
  return entities?.[selected.entity.id] === selected.entity;
}
