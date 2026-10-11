// Client-only compatibility for the offline Paper 1.20.6 server.
const installs = new WeakMap();

/**
 * Drop only play.declare_recipes (protocol 766, packet 0x77) before ProtoDef.
 * Mineflayer 4.39.0 / minecraft-protocol 1.68.0 / minecraft-data 3.117.0
 * still fail on this server's recipe list. Removing a packet event listener
 * or catching bot.error runs after parsing and cannot keep the stream flowing.
 * The input here is one complete, decrypted and decompressed packet frame.
 * Local recipe data remains available; server recipe synchronization is lost.
 * Install synchronously after createBot(), before login; no dependencies or
 * shared protocol schemas are changed. Other packet errors remain visible.
 */
export function installRecipePacketBypass(client, { enabled = true } = {}) {
  if (installs.has(client)) {
    const current = installs.get(client);
    current.setEnabled(enabled);
    return current;
  }
  const parsers = new Map();
  let active = Boolean(enabled), disposed = false, skippedPackets = 0;
  const attach = () => {
    if (disposed || client.state !== 'play' || client.version !== '1.20.6') return;
    const parser = client.deserializer;
    if (!parser || typeof parser._transform !== 'function') throw new Error('Unsupported Minecraft packet parser');
    if (parsers.has(parser)) return;
    const original = parser._transform;
    function transform(chunk, encoding, callback) {
      if (active && client.state === 'play' && client.version === '1.20.6'
          && Buffer.isBuffer(chunk) && chunk[0] === 0x77) {
        skippedPackets++;
        callback();
        return;
      }
      return original.call(this, chunk, encoding, callback);
    }
    parsers.set(parser, { original, transform });
    parser._transform = transform;
  };
  const control = {
    setEnabled(value) { active = Boolean(value); },
    get enabled() { return active && !disposed; },
    get skippedPackets() { return skippedPackets; },
    dispose() {
      if (disposed) return;
      disposed = true;
      client.off('state', attach);
      client.off('end', control.dispose);
      for (const [parser, { original, transform }] of parsers) {
        if (parser._transform === transform) parser._transform = original;
      }
      parsers.clear();
      installs.delete(client);
    }
  };
  client.on('state', attach);
  client.once('end', control.dispose);
  installs.set(client, control);
  attach();
  return control;
}

// Rank tokens and bracketed labels are optional. The real username is the
// final token immediately before the incoming-whisper delimiter.
const INCOMING = /^(?:(?:[◆◇★☆][^\s\[\]:<>]+|\[[^\]\r\n]+\])\s+)*([A-Za-z0-9_]{1,16}) whispers to you: ?([^\r\n]*)$/u;
const FORMAT = /§[0-9A-FK-ORX]/gi;

export function parseServerWhisper(line, originalMessage) {
  if (typeof line !== 'string') return null;
  // Vanilla public-chat components cannot become whispers through their body.
  const translation = originalMessage?.translate ?? originalMessage?.json?.translate;
  if (typeof translation === 'string' && translation.startsWith('chat.type.')) return null;
  const match = INCOMING.exec(line.replace(FORMAT, ''));
  return match ? { sender: match[1], message: match[2] } : null;
}

export function sendPrivateReply(bot, sender, text) {
  if (!/^[A-Za-z0-9_]{1,16}$/.test(sender)) throw new TypeError('Invalid private-message recipient');
  if (typeof text !== 'string' || !text.trim() || /[\x00-\x1f\x7f]/.test(text)) {
    throw new TypeError('Private reply must be one nonempty line');
  }
  const command = `/msg ${sender} ${text}`;
  if (command.length > 256) throw new RangeError('Private reply exceeds Minecraft chat length');
  // Always one command. A rejected reply is never retried as public chat.
  bot.chat(command);
}

/** Install with bot.loadPlugin(), after the built-in chat plugin is ready.
 * Move the application's old whisper callback here to avoid duplicate handling.
 * onWhisper receives {sender, message, reply}; reply always sends /msg.
 */
export function installServerWhispers(bot, onWhisper) {
  if (typeof onWhisper !== 'function') throw new TypeError('Whisper handler is required');
  bot.removeChatPattern('whisper');
  const receive = (line, position, originalMessage) => {
    if (position === 'game_info') return;
    const parsed = parseServerWhisper(line, originalMessage);
    if (!parsed || parsed.sender.toLowerCase() === bot.username?.toLowerCase()) return;
    const event = { ...parsed, reply: text => sendPrivateReply(bot, parsed.sender, text) };
    Promise.resolve().then(() => onWhisper(event)).catch(error => bot.emit('serverWhisperError', error));
  };
  bot.on('messagestr', receive);
  return () => bot.off('messagestr', receive);
}
