import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { Bridge } from '../core/bridge.ts';
import { installMineflayerFixes } from '../core/mineflayer-fixes.ts';
import { parseServerActionDenial } from '../core/server-feedback.ts';
import type { ProtectCell, ProtectReply } from '../core/protection-port.ts';

const require = createRequire(import.meta.url);
const registry = require('minecraft-data')('1.21.1');
const dependency = createRequire(require.resolve('mineflayer'));
const Blocks = dependency('prismarine-block')('1.21.1');
const dest = new Vec3(2, 64, 0), ref = dest.offset(0, -1, 0);
const log = { info() {}, warn() {}, error() {}, debug() {} };

function rig(denyAfter: number | null, options: { path?: boolean; foreign?: 'cell' | 'dimension'; confirmThird?: boolean } = {}) {
  const events = new EventEmitter();
  let sends = 0, placed = false;
  const phases: string[] = [];
  const block = (name: string, position: Vec3) => {
    const result = Blocks.fromStateId(registry.blocksByName[name].minStateId, 0);
    result.position = position; return result;
  };
  const item = { name: 'oak_planks', count: 4, type: registry.itemsByName.oak_planks.id };
  const bot = Object.assign(events, {
    registry, game: { dimension: 'overworld' },
    entity: { position: new Vec3(.5, 64, .5), width: .6, eyeHeight: 1.62, onGround: true, effects: {} },
    entities: {}, heldItem: item, inventory: { items: () => [item], slots: [] },
    _client: Object.assign(new EventEmitter(), { write() { throw Error('No real packet port'); } }),
    craft: async () => {}, placeBlock: async () => {}, lookAt: async () => {},
    pathfinder: { isBuilding: () => options.path === true, setGoal() {} },
    blockAt: (position: Vec3) => block(position.equals(ref) ? 'stone' : placed && position.equals(dest) ? 'oak_planks' : 'air', position),
    _genericPlace: async () => {
      sends++;
      if (sends === denyAfter) deny();
      if (options.confirmThird && sends === 3) placed = true;
    },
    cortiProtectCheck: async (_action: string, cell: ProtectCell, phase = 'before') => {
      phases.push(phase);
      return (bridge as unknown as { observedPlaceDenial(dimension: string, cell: ProtectCell): ProtectReply | null })
        .observedPlaceDenial('overworld', cell);
    },
  }) as unknown as Bot;
  const bridge = new Bridge({ host: 'offline-fixture', port: 25565, username: 'fixture', version: '1.21.1', viewerPort: 0,
    log: log as never, onSpawn() {}, onDisconnect() {} });
  Object.assign(bridge, { _bot: bot });
  function deny() {
    const reply = parseServerActionDenial('MC_PROTECTION ' + JSON.stringify({ schemaVersion: 1, action: 'place', status: 'deny', allowed: false,
      world: options.foreign === 'dimension' ? 'minecraft:the_nether' : 'minecraft:overworld',
      x: dest.x + (options.foreign === 'cell' ? 1 : 0), y: dest.y, z: dest.z,
      retrySameAction: false, reason: 'generated_structure' }))!;
    bridge.noteServerActionDenied(reply);
  }
  if (denyAfter === 0) deny();
  installMineflayerFixes(bot, log as never);
  return { bot, phases, sends: () => sends, place: () => bot.placeBlock(block('stone', ref), new Vec3(0, 1, 0)) };
}

describe('cached exact-cell denial before a placement retry', () => {
  it.each([false, true])('stops before the third send when denial arrives after the second (path=%s)', async path => {
    vi.useFakeTimers();
    try {
      const r = rig(2, { path });
      const result = r.place().then(() => null, error => error as Error);
      await vi.runAllTimersAsync(); const error = await result;
      expect(r.sends()).toBe(2);
      expect(error?.message).toContain('deny');
      expect((r.bot as unknown as { pathPlacementActive?: number }).pathPlacementActive ?? 0).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it.each([0, 1])('still honors denial before/after the first send (%s)', async denyAfter => {
    vi.useFakeTimers();
    try {
      const r = rig(denyAfter);
      const result = expect(r.place()).rejects.toThrow('deny');
      await vi.runAllTimersAsync(); await result;
      expect(r.sends()).toBe(denyAfter);
    } finally { vi.useRealTimers(); }
  });

  it.each(['cell', 'dimension'] as const)('does not apply a foreign %s denial to this placement', async foreign => {
    vi.useFakeTimers();
    try {
      const r = rig(2, { foreign, confirmThird: true });
      const result = expect(r.place()).resolves.toBeUndefined();
      await vi.runAllTimersAsync(); await result;
      expect(r.sends()).toBe(3);
    } finally { vi.useRealTimers(); }
  });

  it('retains bounded retries and actual block confirmation when no denial was received', async () => {
    vi.useFakeTimers();
    try {
      const r = rig(null, { confirmThird: true });
      const result = expect(r.place()).resolves.toBeUndefined();
      await vi.runAllTimersAsync(); await result;
      expect(r.sends()).toBe(3);
      expect(r.phases.filter(phase => phase === 'after_failure')).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });
});
