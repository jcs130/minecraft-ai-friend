import type { Bot } from 'mineflayer';

export interface InventoryDecodeFailure {
  packet: 'window_items' | 'set_slot';
  bytes: number;
  at: number;
  error: string;
}

/** Observe native parser drops; never guess slots or resubmit inventory operations. */
export function installInventoryWireGuard(bot: Bot, failed: (failure: InventoryDecodeFailure) => void): void {
  type Parser = { parsePacketBuffer: (bytes: Buffer) => { metadata: { size: number } } };
  const client = bot._client as unknown as {
    state?: string; deserializer?: Parser;
    on: (name: string, listener: () => void) => void;
    removeListener: (name: string, listener: () => void) => void;
  };
  const parsers = new WeakSet<Parser>();
  const attach = (): void => {
    const parser = client.deserializer;
    if (client.state !== 'play' || !parser || parsers.has(parser)) return;
    const registry = bot.registry as unknown as { protocol?: { play?: { toClient?: { types?: {
      packet?: [string, Array<{ name?: string; type?: [string, { mappings?: Record<string, string> }] }>];
    } } } } };
    const mappings = registry.protocol?.play?.toClient?.types?.packet?.[1]?.find(f => f.name === 'name')?.type?.[1]?.mappings;
    if (!mappings) return;
    const ids = new Map(Object.entries(mappings).filter(([,name]) => name === 'window_items' || name === 'set_slot')
      .map(([id,name]) => [Number(id), name as InventoryDecodeFailure['packet']]));
    const original = parser.parsePacketBuffer;
    parsers.add(parser);
    parser.parsePacketBuffer = function(bytes) {
      const id = readVarint(bytes), packet = id ? ids.get(id.value) : undefined;
      // Player window 0 is one zero byte in both u8 and VarInt versions. Other
      // windows, cursor/standalone slot packets and equipment are not covered.
      const playerInventory = packet && id && bytes[id.offset] === 0;
      try {
        const result = original.call(this, bytes);
        if (playerInventory && result.metadata.size !== bytes.length) {
          // FullPacketParser otherwise prints the short read and emits wrong slots.
          throw Object.assign(new Error('Inventory packet was not consumed completely'), {partialReadError:true});
        }
        return result;
      } catch(error) {
        if (playerInventory) failed({packet, bytes:bytes.length, at:Date.now(),
          error:error instanceof Error ? error.name : 'DecodeError'});
        throw error; // Preserve upstream handling, including silent PartialReadError drops.
      }
    };
  };
  attach();
  client.on('state', attach);
  client.on('end', () => client.removeListener('state', attach));
}

function readVarint(bytes: Buffer): {value:number; offset:number} | undefined {
  let value = 0;
  for (let i = 0; i < 5 && i < bytes.length; i++) {
    const byte = bytes[i]; value |= (byte & 127) << (i * 7);
    if (!(byte & 128)) return {value, offset:i+1};
  }
}
