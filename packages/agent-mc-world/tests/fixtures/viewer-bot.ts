import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';

export const bubbleEntity = (id: number, text: string) => ({
  id, name: 'text_display', position: new Vec3(0, 66, -2), yaw: Math.PI, pitch: 0,
  width: 0, height: 0,
  metadata: { 15: 3, 23: { type: 'compound', value: { text: { type: 'string', value: text } } },
    24: 320, 25: 0x40000000, 26: -1, 27: 1 },
});

export function viewerBot() {
  const registry = minecraftData('1.20.6');
  const protocol = Object.assign(new EventEmitter(), {
    write() { throw new Error('Viewer must not send game actions'); },
  });
  const bot = Object.assign(new EventEmitter(), {
    version: '1.20.6', username: 'ag_Viewer', registry, _client: protocol,
    entity: { id: 1, name: 'player', position: new Vec3(0, 64, 0), velocity: new Vec3(0, 0, 0),
      yaw: 0, pitch: 0, width: .6, height: 1.8, equipment: [], effects: {} },
    entities: { 40: bubbleEntity(40, '中文问候\n继续探索\n▼') },
    world: { getColumn: () => null, getColumnAt: async () => null },
    game: { dimension: 'minecraft:overworld', minY: -64, height: 384 },
    inventory: Object.assign(new EventEmitter(), { slots: Array(46).fill(null), hotbarStart: 36 }),
    time: { timeOfDay: 6000 }, controlState: {}, experience: { level: 0, progress: 0 },
    health: 20, food: 20, quickBarSlot: 0, players: {}, blockAt: () => null,
  });
  return { bot, protocol, registry };
}

export async function freeViewerPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
