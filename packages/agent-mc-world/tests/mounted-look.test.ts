import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { installMountedLook } from '../src/mounted-look.ts';

const dependency = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = dependency('prismarine-registry')('1.20.6');
const Block = dependency('prismarine-block')(registry);

/** Real native physics look and block activation, without a server or physics timer. */
function rig(mounted: boolean) {
  const packets: Array<{ name: string; value: Record<string, unknown> }> = [];
  const client = Object.assign(new EventEmitter(), {
    write(name: string, value: Record<string, unknown>) { packets.push({ name, value }); },
  });
  const bot = Object.assign(new EventEmitter(), {
    registry, version: '1.20.6', _client: client, QUICK_BAR_START: 36,
    supportFeature: (name: string) => registry.supportFeature(name),
    swingArm() {}, blockAt: () => null,
    entity: { position: new Vec3(.5, 64, .5), yaw: 0, pitch: 0, eyeHeight: 1.62, onGround: false },
    vehicle: mounted ? { id: 7 } : null,
  }) as unknown as Bot;
  dependency('./lib/plugins/inventory.js')(bot, { hideErrors: true });
  dependency('./lib/plugins/physics.js')(bot, { physicsEnabled: true });
  const target = Block.fromStateId(registry.blocksByName.oak_button.defaultState);
  target.position = new Vec3(1, 64, 0);
  return { bot, packets, target };
}

describe('native passenger look', () => {
  it('sends rotation before native block use while passenger walking physics is suspended', async () => {
    const r = rig(true);
    installMountedLook(r.bot);
    await r.bot.activateBlock(r.target);
    expect(r.packets.map(p => p.name)).toEqual(['look', 'block_place']);
    expect(r.packets[0].value).toMatchObject({ yaw: expect.any(Number), pitch: expect.any(Number), onGround: false });
    expect(r.packets[0].value.pitch).not.toBe(0);
    expect(r.packets[1].value.location).toEqual(r.target.position);
    expect(r.packets.some(p => p.name === 'position' || p.name === 'position_look')).toBe(false);
  });

  it('keeps the native standing look wait and explicit force behavior', async () => {
    const r = rig(false);
    installMountedLook(r.bot);
    let finished = false;
    const activation = r.bot.activateBlock(r.target).then(() => { finished = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(finished).toBe(false);
    expect(r.packets).toEqual([]);
    await r.bot.look(r.bot.entity.yaw, r.bot.entity.pitch, true);
    await activation;
    expect(r.packets.map(p => p.name)).toEqual(['block_place']);
  });

  it('installs once and restores the native unresolved passenger look', async () => {
    const r = rig(true);
    const restore = installMountedLook(r.bot);
    expect(installMountedLook(r.bot)).toBe(restore);
    await r.bot.activateBlock(r.target);
    expect(r.packets.filter(p => p.name === 'look')).toHaveLength(1);
    restore(); r.packets.length = 0;
    r.target.position = new Vec3(-1, 64, 0);
    let finished = false;
    const activation = r.bot.activateBlock(r.target).then(() => { finished = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(finished).toBe(false);
    expect(r.packets).toEqual([]);
    await r.bot.look(r.bot.entity.yaw, r.bot.entity.pitch, true);
    await activation;
  });
});
