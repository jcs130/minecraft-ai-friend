import { parseTeleportRequest, parseTeleportWarmup, parseTrChatLine, stripCustomGlyphs } from './chat.mjs';

const plainOf = (message) => {
  try { return typeof message?.toString === 'function' ? String(message.toString()) : String(message ?? ''); } catch { return ''; }
};
const jsonOf = (message) => (message && typeof message === 'object' ? (message.json ?? message) : null);

/**
 * Bounded per-connection observations for 橘乡 chat/teleport/resource-pack. Read only.
 * @param {import('mineflayer').Bot} bot
 */
export function observeTangerine(bot, { clock = () => new Date().toISOString(), acceptResourcePack = true, onEvent } = {}) {
  const teleports = [], chat = [];
  let warmup = null, glyphsStripped = 0, resourcePack = { offered: 0, accepted: 0, lastError: null }, closed = false;
  const known = (name) => !!bot.players?.[name] && name !== bot.username;
  const push = (list, row, max) => { list.push(row); if (list.length > max) list.shift(); };
  const onMessage = (message, position) => {
    if (closed || position === 'game_info') return;
    const raw = plainOf(message);
    const { text, glyphs } = stripCustomGlyphs(raw);
    glyphsStripped += glyphs;
    const at = clock();
    const tp = parseTeleportRequest(text, jsonOf(message));
    if (tp) { push(teleports, { at, ...tp }, 8); onEvent?.({ event: 'teleport-request', from: tp.from, kind: tp.kind }); return; }
    const w = parseTeleportWarmup(text);
    if (w) { warmup = { at, ...w }; return; }
    const line = parseTrChatLine(text, known);
    if (line) push(chat, { at, ...line }, 10);
  };
  const onPack = () => {
    if (closed) return;
    resourcePack.offered++;
    if (!acceptResourcePack) return;
    try { bot.acceptResourcePack(); resourcePack.accepted++; onEvent?.({ event: 'resource-pack-accepted' }); }
    catch (error) { resourcePack.lastError = String(error?.message ?? error).slice(0, 160); }
  };
  bot.on('message', onMessage);
  bot.on('resourcePack', onPack);
  const close = () => {
    if (closed) return;
    closed = true;
    bot.off?.('message', onMessage);
    bot.off?.('resourcePack', onPack);
  };
  bot.once?.('end', close);
  return {
    close,
    snapshot: () => ({
      teleportRequests: teleports.slice(-3), teleportWarmup: warmup, recentPlayerChat: chat.slice(-5),
      resourcePack: { ...resourcePack, policy: acceptResourcePack ? 'accept' : 'ignore' }, glyphsStripped,
    }),
  };
}
