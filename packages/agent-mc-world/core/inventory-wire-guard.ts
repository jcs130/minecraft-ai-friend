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
    const registry = bot.registry as unknown as { protocol?: { play?: { toClient?: { types?: {
      packet?: [string, Array<{ name?: string; type?: [string, { mappings?: Record<string, string> }] }>];
    } } } } };
    const mappings = registry.protocol?.play?.toClient?.types?.packet?.[1]?.find(f => f.name === 'name')?.type?.[1]?.mappings;
    if (!mappings) return;
    const inventoryPackets = new Set(['window_items', 'set_slot', 'set_cursor_item', 'set_player_inventory']);
    const ids = new Map(Object.entries(mappings).filter(([,name]) => inventoryPackets.has(name))
      .map(([id,name]) => [Number(id), name as InventoryDecodeFailure['packet']]));
    const varintContainer = (bot.registry as unknown as {protocol?: {types?: {ContainerID?: unknown}}}).protocol?.types?.ContainerID === 'varint';
    const original = parser.parsePacketBuffer;
    parsers.add(parser);
    parser.parsePacketBuffer = function(bytes) {
      const id = readVarint(bytes), packet = id ? ids.get(id.value) : undefined;
      // Closed-window late packets must not poison the current inventory.
      // Modern ContainerID is VarInt, not one byte (menu IDs can exceed 127).
      const windowId = id && (varintContainer ? readVarint(bytes.subarray(id.offset))?.value : bytes[id.offset]);
      const relevant = packet === 'set_cursor_item' || packet === 'set_player_inventory'
        || !!packet && (windowId === 0 || windowId === bot.currentWindow?.id
          || packet === 'set_slot' && (windowId === -1 || windowId === 255));
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

function readVarint(bytes: Buffer): {value:number; offset:number} | undefined {
  let value = 0;
  for (let i = 0; i < 5 && i < bytes.length; i++) {
    const byte = bytes[i]; value |= (byte & 127) << (i * 7);
    if (!(byte & 128)) return {value, offset:i+1};
  }
}
