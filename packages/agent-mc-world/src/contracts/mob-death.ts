/** The entities and damage type reported by the server's final death event. */
export interface DeathEntityRef {
  entityId: number;
  uuid: string;
  type: string | null;
  name: string | null;
}

export interface MobDeathReceipt {
  schemaVersion: 1;
  eventId: string;
  occurredAt: number;
  world: string;
  victim: DeathEntityRef;
  damageType: string;
  causingEntity: DeathEntityRef | null;
  directEntity: DeathEntityRef | null;
  indirect: boolean;
}
