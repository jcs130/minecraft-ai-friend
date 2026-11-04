const playerName = /^[A-Za-z0-9_.-]{1,32}$/;
const component = value => value?.json ?? value;

function plainText(value, depth = 0) {
  if (depth > 8) return null;
  value = component(value);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const parts = value.map(part => plainText(part, depth + 1));
    return parts.includes(null) ? null : parts.join('');
  }
  if (!value || typeof value !== 'object' || (value.text !== undefined && typeof value.text !== 'string')) return null;
  if (value.translate || value.selector || value.score || value.keybind) return null;
  const extra = plainText(value.extra ?? [], depth + 1);
  return extra === null ? null : (value.text ?? '') + extra;
}

// Only the server-selected native incoming-message component establishes a
// private request. Display text and nested components never grant that authority.
export function privateGoddessMessage(message, position) {
  if (position !== 'system' && position !== 'chat') return null;
  const root = component(message);
  if (!root || root.translate !== 'commands.message.display.incoming'
      || root.text !== undefined || !Array.isArray(root.with) || root.with.length !== 2) return null;
  const sender = component(root.with[0]);
  const player = typeof sender === 'string' ? sender
    : sender?.insertion ?? sender?.hoverEvent?.contents?.name ?? sender?.text;
  if (typeof player !== 'string' || !playerName.test(player)) return null;
  const body = plainText(root.with[1]);
  return body === null ? null : { player, message: body };
}

// Modern Mineflayer resolves translation keys while rendering ChatMessage. Use
// the server's registered incoming-message type before rendering loses its ID.
export function privateGoddessPacket(packet, registry) {
  const id = packet?.type?.chatType ?? packet?.type;
  const format = Number.isInteger(id) ? registry?.chatFormattingById?.[id] : null;
  if (format?.name !== 'minecraft:msg_command_incoming'
      || JSON.stringify(format.parameters) !== '["sender","content"]') return null;
  try {
    const sender = JSON.parse(packet.senderName);
    const body = packet.formattedMessage ? JSON.parse(packet.formattedMessage) : {text:packet.plainMessage};
    const native = privateGoddessMessage({translate:'commands.message.display.incoming',with:[sender,body]}, 'chat');
    const account = component(sender)?.hoverEvent?.contents?.id;
    if (native && account && packet.sender
        && String(account).replaceAll('-','').toLowerCase() !== String(packet.sender).replaceAll('-','').toLowerCase()) return null;
    return native;
  } catch { return null; }
}

export function listenPrivateGoddessMessages(bot, receive) {
  const formatted = bot.supportFeature?.('clientsideChatFormatting') === true;
  bot._client?.on('playerChat', packet => {
    if (!formatted) return;
    const incoming = privateGoddessPacket(packet,bot.registry);
    if (incoming) receive(incoming);
  });
  bot.on('messagestr', (_text,position,message) => {
    if (formatted && position !== 'system') return;
    const incoming = privateGoddessMessage(message,position);
    if (incoming) receive(incoming);
  });
}
