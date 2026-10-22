// minecraft-protocol may already know an offline UUID while HANDSHAKING. A UUID
// alone is not permission to serialize a PLAY custom_payload packet.
export function observeWhenPlaying(bot, factory) {
  let observer = null, closed = false;
  const start = () => {
    if (!closed && !observer && bot._client.state === 'play' && bot.entity && bot._client.uuid) observer = factory(bot);
  };
  const close = () => { if (closed) return; closed = true; bot.off('spawn', start); bot.off('end', close); observer?.close(); observer = null; };
  bot.on('spawn', start); bot.on('end', close); start();
  return { snapshot: () => observer?.snapshot() ?? null, close };
}

// Only actual same-connection receipts may supplement the vanilla HUD.
export function skillPresentation(snapshot, uuid, now = Date.now()) {
  if (!snapshot?.available || snapshot.bodyId?.toLowerCase() !== uuid?.toLowerCase()) return null;
  const rows = Object.values(snapshot.states ?? {}).filter(row => row.channel?.endsWith(':state') && Number.isFinite(Date.parse(row.observedAt)))
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  if (!rows.length) return null;
  const result = { playerUuid: uuid.toLowerCase(), mana: null, skills: [], abilities: [],
    source: 'same_player_mcagent_mcviewer_plugin_receipts', observedAt: 0, stale: false };
  let abilitiesObservedAt = 0;
  for (const row of rows) {
    for (const key of ['mana', 'skills', 'abilities']) if (row.value[key] !== undefined) result[key] = structuredClone(row.value[key]);
    result.observedAt = Date.parse(row.observedAt);
    if (row.value.abilities !== undefined) abilitiesObservedAt = result.observedAt;
  }
  result.stale = now - result.observedAt > 15000;
  // Remaining time is an explicitly supplied quantity; never reinterpret a
  // historical ambiguous cooldownMs field as a known remaining duration.
  result.abilities = (result.abilities ?? []).slice(0, 24).map(row => ({ ...row,
    cooldownRemainingMs: Number.isFinite(row.cooldownRemainingMs)
      ? Math.max(0, row.cooldownRemainingMs - Math.max(0, now - abilitiesObservedAt)) : null }));
  return result;
}
