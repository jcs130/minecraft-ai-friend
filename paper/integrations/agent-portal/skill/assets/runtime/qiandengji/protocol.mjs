/** Read only this body's server receipts; no world actions or additional connection. */
export const CHANNELS = ['mcagent:state', 'mcviewer:state', 'mcagent:event', 'mcagent:protection'];
const idPattern = /^[a-z0-9_:.-]+$/;
export function decodePacket(channel, bytes, uuid) {
  if (!CHANNELS.includes(channel) || !Buffer.isBuffer(bytes) || bytes.length > 16384 || !bytes.length) return null;
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1) return null;
  for (const field of ['playerUuid', 'uuid']) if (value[field] !== undefined
    && (typeof value[field] !== 'string' || typeof uuid !== 'string' || value[field].toLowerCase() !== uuid.toLowerCase())) return null;
  if (value.viewerSession) for (const field of ['recipientUuid', 'playerUuid']) {
    const id = value.viewerSession[field];
    if (id !== undefined && (typeof id !== 'string' || typeof uuid !== 'string' || id.toLowerCase() !== uuid.toLowerCase())) return null;
  }
  if (channel.endsWith(':state')) {
    if (value.mana != null && (typeof value.mana !== 'object'
      || !Number.isFinite(value.mana.current) || !Number.isFinite(value.mana.max)
      || value.mana.current < 0 || value.mana.max < 0)) return null;
    for (const key of ['skills', 'abilities']) if (value[key] != null
      && (!Array.isArray(value[key]) || value[key].length > 24
        || value[key].some(row => !row || typeof row.id !== 'string' || !idPattern.test(row.id)))) return null;
  }
  return value;
}

export function observeQiandengji(bot, clock = () => new Date().toISOString()) {
  const bodyId = bot._client.uuid ?? bot.player?.uuid ?? bot.uuid;
  const states = new Map(), receipts = [];
  let closed = false, rejected = 0;
  const onPacket = packet => {
    if (closed || !CHANNELS.includes(packet.channel)) return;
    const value = decodePacket(packet.channel, packet.data, bodyId);
    if (value === null) { rejected++; return; }
    const row = { channel: packet.channel, observedAt: clock(), value };
    if (packet.channel.endsWith(':state')) states.set(packet.channel, row);
    else { receipts.push(row); if (receipts.length > 32) receipts.shift(); }
  };
  const close = () => {
    closed = true; states.clear(); receipts.length = 0;
    bot._client.off('custom_payload', onPacket); bot._client.off('end', close);
  };
  bot._client.on('custom_payload', onPacket); bot._client.once('end', close);
  bot._client.write('custom_payload', { channel: 'minecraft:register', data: Buffer.from(CHANNELS.join('\0'), 'utf8') });
  return { close, snapshot: () => ({ bodyId, sampledAt: clock(), available: !closed && typeof bodyId === 'string',
    rejectedPackets: rejected, states: Object.fromEntries(states), receipts: receipts.slice(-3) }) };
}
