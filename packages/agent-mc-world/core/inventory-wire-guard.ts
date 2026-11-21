import type { Bot } from 'mineflayer';

export interface InventoryDecodeFailure {
  packet: 'window_items' | 'set_slot' | 'set_cursor_item' | 'set_player_inventory';
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
    const registry = bot.registry as unknown as { protocol?: {
      types?: { ContainerID?: string };
      play?: { toClient?: { types?: {
        packet?: [string, Array<{ name?: string; type?: [string, { mappings?: Record<string, string> }] }>];
      } } };
    } };
    const mappings = registry.protocol?.play?.toClient?.types?.packet?.[1]?.find(f => f.name === 'name')?.type?.[1]?.mappings;
    if (!mappings) return;
    const inventoryPackets = new Set(['window_items', 'set_slot', 'set_cursor_item', 'set_player_inventory']);
    const ids = new Map(Object.entries(mappings).filter(([,name]) => inventoryPackets.has(name))
      .map(([id,name]) => [Number(id), name as InventoryDecodeFailure['packet']]));
    const varintContainer = registry.protocol?.types?.ContainerID === 'varint';
    const original = parser.parsePacketBuffer;
    parsers.add(parser);
    parser.parsePacketBuffer = function(bytes) {
      const id = readVarint(bytes);
      const packet = id && ids.get(id.value);
      if (!id || !packet) return original.call(this, bytes);
      // Modern ContainerID is VarInt. Quarantine packets whose window ID was
      // truncated, but ignore an identified closed-window response.
      const windowId = varintContainer ? readVarint(bytes, id.offset)?.value : bytes[id.offset];
      const relevant = packet === 'set_cursor_item' || packet === 'set_player_inventory'
        || windowId === undefined || windowId === 0 || windowId === bot.currentWindow?.id
        || (packet === 'set_slot' && (windowId === -1 || (!varintContainer && windowId === 255)));
      try {
        const result = original.call(this, bytes);
        if (relevant && result.metadata.size !== bytes.length) {
          // FullPacketParser otherwise prints the short read and emits wrong slots.
          throw Object.assign(new Error('Inventory packet was not consumed completely'), {partialReadError:true});
        }
        return result;
      } catch(error) {
        if (relevant) failed({packet, bytes:bytes.length, at:Date.now(),
          error:error instanceof Error ? error.name : 'DecodeError'});
        throw error; // Preserve upstream handling, including silent PartialReadError drops.
      }
    };
  };
  attach();
  client.on('state', attach);
  client.on('end', () => client.removeListener('state', attach));
}

function readVarint(bytes: Buffer, offset = 0): {value:number; offset:number} | undefined {
  let value = 0;
  for (let i = 0; i < 5 && offset + i < bytes.length; i++) {
    const byte = bytes[offset + i];
    value |= (byte & 127) << (i * 7);
    if (!(byte & 128)) return {value, offset:offset+i+1};
  }
}
