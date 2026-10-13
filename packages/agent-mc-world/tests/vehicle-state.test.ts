import { describe, expect, it } from 'vitest';
import { Vec3 } from 'vec3';
import { narrateVehicleState, vehicleStateFromBot } from '../src/vehicle-state.ts';
import { narrateWorld, narrateWorldSegments, snapshotFingerprint, snapshotFromBot } from '../core/terrain.ts';

function rig() {
  return { entity: { position: new Vec3(-542, 67, -441), velocity: new Vec3(0, 0, 0), yaw: 0, onGround: false },
    entities: {}, registry: {}, game: { dimension: 'overworld', gameMode: 'survival' },
    blockAt: () => null, findBlocks: () => [], health: 20, food: 20,
    time: { timeOfDay: 6000 }, players: {}, heldItem: null,
    inventory: { slots: [], items: () => [], selectedItem: null },
    vehicle: null as { id: number; name: string; position: Vec3; velocity: Vec3 } | null };
}

describe('vehicle attachment as current embodied facts', () => {
  it('does not treat missing live self state as a confirmed dismount', () => {
    expect(vehicleStateFromBot(null)).toBeUndefined();
    expect(vehicleStateFromBot({ vehicle: { id: 7 } })).toBeUndefined();
    expect(narrateVehicleState(undefined)).toContain('未取得读数');
    expect(vehicleStateFromBot({ entity: {} })).toBeNull();
  });
  it('carries separate vehicle coordinates without aliasing moving native objects', () => {
    const bot = rig();
    bot.vehicle = { id: 7, name: 'minecart', position: new Vec3(-542, 67.1, -441), velocity: new Vec3(.2, 0, 0) };
    const s = snapshotFromBot(bot, { scanBlocks: false });
    expect(s.vehicle).toMatchObject({ entityId: 7, name: 'minecart', position: { x: -542, y: 67.1, z: -441 }, velocity: { x: .2, y: 0, z: 0 } });
    bot.vehicle.position.x = -539;
    expect(s.vehicle?.position?.x).toBe(-542);
    expect(narrateWorld(s)).toContain('正在乘坐 minecart');
    expect(narrateWorld(s)).not.toContain('我站着没动');
    expect(narrateWorld(s)).not.toContain('站在格');
  });
  it('invalidates the quiet and segment baselines on mount, vehicle change and dismount at the same position', () => {
    const bot = rig(), before = snapshotFromBot(bot, { scanBlocks: false });
    bot.vehicle = { id: 7, name: 'minecart', position: new Vec3(-542, 67, -441), velocity: new Vec3(0, 0, 0) };
    const mounted = snapshotFromBot(bot, { scanBlocks: false });
    bot.vehicle.id = 8;
    const changed = snapshotFromBot(bot, { scanBlocks: false });
    bot.vehicle = null;
    const after = snapshotFromBot(bot, { scanBlocks: false });
    const states = [before, mounted, changed, after];
    for (let i=1; i<states.length; i++) {
      expect(snapshotFingerprint(states[i])).not.toBe(snapshotFingerprint(states[i-1]));
      expect(narrateWorldSegments(states[i]).find(s=>s.key==='vehicle')?.cmp)
        .not.toBe(narrateWorldSegments(states[i-1]).find(s=>s.key==='vehicle')?.cmp);
    }
    expect(narrateWorld(after)).toContain('客户端当前未报告乘坐载具');
    expect(narrateWorld(after)).not.toContain('正在乘坐 minecart');
  });
  it('keeps invalid entity identity and coordinates unknown instead of inventing zero readings', () => {
    expect(vehicleStateFromBot({ entity: {}, vehicle: { position: { x: NaN, y: 3, z: 2 }, velocity: {} } }))
      .toEqual({ entityId: null, name: null, position: null, velocity: null });
  });
});
