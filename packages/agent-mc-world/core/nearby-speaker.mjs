const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORLD = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
const DECORATION_PREFIX = 'qiandengji:nearby:';

function displayField(value, limit) {
  return typeof value === 'string' && value.length <= limit && !!value.trim()
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

/** Parse a snapshot already carried by the matching native speaker packet. */
export function readNearbySpeaker(row, expectedUuid) {
  if (!row || typeof row.uuid !== 'string' || typeof expectedUuid !== 'string'
      || !UUID.test(row.uuid) || row.uuid.toLowerCase() !== expectedUuid.toLowerCase()
      || !displayField(row.name, 64) || !displayField(row.displayName, 160)
      || typeof row.world !== 'string' || row.world.length > 160 || !WORLD.test(row.world)
      || typeof row.worldUuid !== 'string' || !UUID.test(row.worldUuid)
      || !Number.isSafeInteger(row.observedAt) || row.observedAt <= 0
      || row.observedAt > 8_640_000_000_000_000) return undefined;
  const { x, y, z } = row.position ?? {};
  if (![x, y, z].every(Number.isFinite)) return undefined;
  return { uuid: row.uuid.toLowerCase(), name: row.name, displayName: row.displayName,
    world: row.world, worldUuid: row.worldUuid.toLowerCase(), observedAt: row.observedAt, position: { x, y, z } };
}

/** Only called on the unsigned server decoration of a native player packet. */
export function nearbySpeakerFromDecoration(unsigned, senderUuid) {
  const pending = [unsigned?.json];
  for (let visited = 0; pending.length && visited < 64; visited++) {
    const node = pending.pop();
    if (!node || typeof node !== 'object') continue;
    if (node.text === '' && typeof node.insertion === 'string'
        && node.insertion.startsWith(DECORATION_PREFIX) && node.insertion.length <= 1024) {
      try {
        return readNearbySpeaker(JSON.parse(node.insertion.slice(DECORATION_PREFIX.length)), senderUuid);
      } catch {
        return undefined;
      }
    }
    for (const children of [node.with, node.extra]) {
      if (Array.isArray(children)) pending.push(...children.slice(0, 32));
    }
  }
  return undefined;
}

export function nearbySpeakerContext(origin) {
  return `\n[服务端发言采样，仅对应发言时] ${JSON.stringify({ ...origin, observedAt: new Date(origin.observedAt).toISOString() })}`;
}
