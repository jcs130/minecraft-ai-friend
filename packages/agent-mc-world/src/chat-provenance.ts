/** Identity evidence for Mineflayer's text-pattern chat events. */
interface ChatMessage {
  translate?: string;
  with?: Array<string | { toString(): string }>;
  json?: { translate?: string; with?: Array<string | { toString(): string }> };
  unsigned?: { toString(): string };
  toString?(): string;
}

interface Player {
  username?: string;
  uuid?: string;
}

interface MessageSource {
  position: string;
  sender: string | null;
}

export interface ChatIdentityEvidence {
  chatTransport: string;
  identityEvidence: 'packet-sender' | 'player-list-format' | 'explicit-chat-event';
  senderUuid?: string;
}

/** Match the protocol's incoming type, never a rendered player's quoted text.
 * prismarine-registry resolves translation keys to format strings before
 * prismarine-chat constructs the component on modern Java connections. */
function privateParts(message: ChatMessage, registry: unknown, direction: 'incoming' | 'outgoing'): { username: string; message: string } | null {
  const key = message.translate ?? message.json?.translate ?? '';
  const parts = message.with ?? message.json?.with;
  if (!parts) return null;
  let sender = 0, content = 1;
  if (key !== `commands.message.display.${direction}`) {
    const format = (registry as { chatFormattingByName?: Record<string, { formatString?: string; parameters?: string[] }> } | undefined)
      ?.chatFormattingByName?.[`minecraft:msg_command_${direction}`];
    if (!format || !key || format.formatString !== key || !Array.isArray(format.parameters)) return null;
    sender = format.parameters.indexOf(direction === 'incoming' ? 'sender' : 'target');
    if (sender < 0 && direction === 'outgoing') sender = format.parameters.indexOf('sender');
    content = format.parameters.indexOf('content');
    if (sender < 0 || content < 0 || sender === content) return null;
  }
  const username = parts[sender]?.toString() ?? '';
  const body = parts[content]?.toString();
  return /^\w{1,16}$/.test(username) && body !== undefined ? { username, message: body } : null;
}

export const incomingPrivateParts = (message: ChatMessage, registry?: unknown) => privateParts(message, registry, 'incoming');
export const outgoingPrivateParts = (message: ChatMessage, registry?: unknown) => privateParts(message, registry, 'outgoing');

export class MinecraftChatProvenance {
  private readonly sources = new WeakMap<object, MessageSource>();

  observe(message: unknown, position: string, sender?: string | null): void {
    if (message && typeof message === 'object')
      this.sources.set(message, { position, sender: sender ?? null });
  }

  /** Modern raw chat types may contain only content. The packet UUID, rather
   * than a formatted display name, supplies the speaker. Unsigned decoration
   * is server presentation evidence, never identity or private authority. */
  publicChat(message: ChatMessage, players: Record<string, Player> = {}, registry?: unknown) {
    const source = this.sources.get(message);
    if (source?.position !== 'chat' || !source.sender
      || incomingPrivateParts(message, registry) || outgoingPrivateParts(message, registry)) return null;
    const listed = Object.entries(players).find(([, player]) => player.uuid === source.sender);
    const username = listed && (listed[1].username ?? listed[0]);
    if (!username || !/^\w{1,16}$/.test(username)) return null;
    const key = message.translate ?? message.json?.translate;
    const parts = message.with ?? message.json?.with;
    const formats = Object.values((registry as { chatFormattingByName?: Record<string,
      { formatString?: string; parameters?: string[] }> } | undefined)?.chatFormattingByName ?? {})
      .filter(format => format.formatString === key && Array.isArray(format.parameters));
    const indexes = new Set(formats.map(format => format.parameters!.indexOf('content')));
    const contentIndex = key === 'chat.type.text' ? 1
      : indexes.size === 1 && !indexes.has(-1) ? [...indexes][0] : undefined;
    const body = contentIndex === undefined ? message.toString?.() : parts?.[contentIndex]?.toString();
    if (!body?.trim()) return null;
    const serverRenderedText = message.unsigned?.toString().slice(0, 32_768);
    return { username, message: body,
      identity: { chatTransport: source.position, identityEvidence: 'packet-sender' as const, senderUuid: source.sender },
      ...(serverRenderedText ? { serverRenderedText } : {}) };
  }

  /** Never promote public quotes to whispers; a packet UUID mismatch wins
   * over a claimed name. Rank/tag text is not identity evidence. */
  incomingWhisper(message: ChatMessage, players: Record<string, Player> = {}, registry?: unknown) {
    const source = this.sources.get(message);
    const key = message.translate ?? message.json?.translate ?? '';
    const incoming = incomingPrivateParts(message, registry);
    if (!source || source.position === 'game_info'
      || key === 'commands.message.display.outgoing' || outgoingPrivateParts(message, registry)) return null;
    // Translation arguments carry the sender/body independently of the client's
    // language. Parsing only the English rendered sentence lost private identity
    // on localized 1.21.1 messages delivered through system_chat.
    if (incoming) {
      const identity = this.identify(incoming.username, message, players);
      return identity ? { ...incoming, identity } : null;
    }
    // A decorated modern public packet can quote a whisper verbatim. Only its
    // native private type above can grant private-channel authority.
    if (message.unsigned) return null;
    const text = message.toString?.().replace(/§[0-9A-FK-ORX]/gi, '') ?? '';
    if (/^\s*</.test(text)) return null;
    const match = /(?<!\w)(\w{1,16}) whispers to you: ?([^\r\n]*)$/i.exec(text);
    if (!match) return null;
    // Plugin chat can also carry public "Name: quoted text" lines.
    // Formatting prefixes may contain ranks/tags, but not a preceding message.
    if (/[<>:\r\n]/.test(text.slice(0, match.index))) return null;
    const identity = this.identify(match[1]!, message, players);
    if (!identity) return null;
    const player = Object.entries(players).find(([key, value]) =>
      (value.username ?? key).toLowerCase() === match[1]!.toLowerCase());
    return { username: player?.[1].username ?? player?.[0] ?? match[1]!, message: match[2]!, identity };
  }

  outgoingWhisper(message: ChatMessage, players: Record<string, Player>, self: string, selfUuid?: string, registry?: unknown) {
    const source = this.sources.get(message);
    if (!source || source.position === 'game_info') return null;
    const canonical = outgoingPrivateParts(message, registry);
    if (message.unsigned && !canonical) return null;
    const text = message.toString?.().replace(/§[0-9A-FK-ORX]/gi, '') ?? '';
    const match = /(?<!\w)You whisper to (\w{1,16}): ?([^\r\n]*)$/i.exec(text);
    if (!canonical && (!match || /[<>:\r\n]/.test(text.slice(0, match.index)))) return null;
    const recipient = canonical?.username ?? match![1]!;
    const known = Object.entries(players).find(([key, p]) => (p.username ?? key).toLowerCase() === recipient.toLowerCase());
    const ownUuid = selfUuid ?? Object.entries(players).find(([key,p]) => (p.username ?? key).toLowerCase() === self.toLowerCase())?.[1].uuid;
    if (!canonical && (!known || (source.sender && source.sender !== ownUuid))) return null;
    return { username: self, recipient: known?.[1].username ?? known?.[0] ?? recipient,
      message: canonical?.message ?? match![2]!, identity: { chatTransport: source.position,
        identityEvidence: source.sender && source.sender === ownUuid ? 'packet-sender' : 'player-list-format',
        ...(source.sender && source.sender === ownUuid ? { senderUuid: source.sender } : {}) } };
  }

  identify(username: string, message: unknown, players: Record<string, Player> = {}): ChatIdentityEvidence | null {
    if ((message as ChatMessage | undefined)?.translate === 'commands.message.display.outgoing') return null;
    const source = message && typeof message === 'object' ? this.sources.get(message) : undefined;
    // Custom plugins may emit chat directly, without a preceding message packet.
    if (!source) return { chatTransport: 'unknown', identityEvidence: 'explicit-chat-event' };
    if (source.position === 'game_info') return null;
    const listed = Object.entries(players);
    if (source.sender) {
      const sender = listed.find(([, player]) => player.uuid === source.sender);
      if (!sender || (sender[1].username ?? sender[0]).toLowerCase() !== username.toLowerCase()) return null;
      return { chatTransport: source.position, identityEvidence: 'packet-sender', senderUuid: source.sender };
    }
    const player = listed.find(([key, value]) => (value.username ?? key).toLowerCase() === username.toLowerCase());
    return player ? { chatTransport: source.position, identityEvidence: 'player-list-format',
      // Preserve the actual online-list identity for downstream companion routing.
      // This is still format/list evidence, never upgraded to a signed packet.
      ...(player[1].uuid ? { senderUuid: player[1].uuid } : {}) } : null;
  }
}
