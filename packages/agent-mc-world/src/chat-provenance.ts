/** Identity evidence for Mineflayer's text-pattern chat events. */
interface ChatMessage {
  translate?: string;
  json?: { translate?: string };
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

export class MinecraftChatProvenance {
  private readonly sources = new WeakMap<object, MessageSource>();

  observe(message: unknown, position: string, sender?: string | null): void {
    if (message && typeof message === 'object')
      this.sources.set(message, { position, sender: sender ?? null });
  }

  /** Never promote public quotes to whispers; a packet UUID mismatch wins
   * over a claimed name. Rank/tag text is not identity evidence. */
  incomingWhisper(message: ChatMessage, players: Record<string, Player> = {}) {
    const source = this.sources.get(message);
    const key = message.translate ?? message.json?.translate ?? '';
    if (!source || source.position === 'game_info' || key.startsWith('chat.type.')
      || key === 'commands.message.display.outgoing'
      || (source.position === 'chat' && key !== 'commands.message.display.incoming')) return null;
    const text = message.toString?.().replace(/§[0-9A-FK-ORX]/gi, '') ?? '';
    if (/^\s*</.test(text)) return null;
    const match = /(?:^|\s)(\w{1,16}) whispers to you: ?([^\r\n]*)$/i.exec(text);
    if (!match) return null;
    // System-chat plugins can also carry public "Name: quoted text" lines.
    // Formatting prefixes may contain ranks/tags, but not a preceding message.
    if (/[<>:\r\n]/.test(text.slice(0, match.index))) return null;
    const identity = this.identify(match[1]!, message, players);
    if (!identity) return null;
    const player = Object.entries(players).find(([key, value]) =>
      (value.username ?? key).toLowerCase() === match[1]!.toLowerCase());
    return { username: player?.[1].username ?? player?.[0] ?? match[1]!, message: match[2]!, identity };
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
    return player ? { chatTransport: source.position, identityEvidence: 'player-list-format' } : null;
  }
}
