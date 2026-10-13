/** Identity evidence for Mineflayer's text-pattern chat events. */
interface ChatMessage {
  translate?: string;
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
