/** Damage numbers must come from the server, which owns mob health and final damage. */
export const VIEWER_COMBAT_CHANNEL = 'mcviewer:combat';

export interface ViewerCombatHit {
  id: number;
  amount: number;
  critical: boolean;
}

export function parseViewerCombatHit(channel: unknown, data: unknown, ownEntityId: number): ViewerCombatHit | null {
  if (channel !== VIEWER_COMBAT_CHANNEL || !Buffer.isBuffer(data) || data.length > 2_048) return null;
  let value: unknown;
  try { value = JSON.parse(data.toString('utf8')); } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  const packet = value as Record<string, unknown>;
  if (packet.schemaVersion !== 1 || packet.attackerEntityId !== ownEntityId ||
      !Number.isSafeInteger(packet.targetEntityId) || (packet.targetEntityId as number) < 0 ||
      typeof packet.damage !== 'number' || !Number.isFinite(packet.damage) ||
      packet.damage <= 0 || packet.damage > 2_048 || typeof packet.critical !== 'boolean') return null;
  return { id: packet.targetEntityId as number, amount: packet.damage, critical: packet.critical };
}
