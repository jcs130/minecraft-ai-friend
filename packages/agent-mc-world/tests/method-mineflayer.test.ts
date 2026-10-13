import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { methodHarness, methodEnded } from './method-harness.ts';
import { installNavigationBareHand } from '../core/hand-interaction.ts';

const dependency = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = dependency('prismarine-registry')('1.20.6');
const Item = dependency('prismarine-item')(registry);
const Block = dependency('prismarine-block')(registry);
const rigs: ReturnType<typeof methodHarness>[] = [];
afterEach(() => rigs.splice(0).forEach(r => r.close()));

/** Real Mineflayer inventory, physics controls, look, activation and placement; no network connection. */
function rig() {
  const r = methodHarness(); rigs.push(r);
  const bot = r.bot as unknown as Bot;
  const packets: Array<{ name: string; value: Record<string, unknown>; hand: string | null }> = [];
  let receive = (_name: string, _value: Record<string, unknown>) => {};
  Object.assign(bot, { supportFeature: (name: string) => registry.supportFeature(name), swingArm() {} });
  bot._client.write = ((name: string, value: Record<string, unknown>) => {
    packets.push({ name, value, hand: bot.heldItem?.name ?? null }); receive(name, value);
  }) as never;
  dependency('./lib/plugins/simple_inventory.js')(bot);
  dependency('./lib/plugins/inventory.js')(bot, { hideErrors: true });
  dependency('./lib/plugins/physics.js')(bot, { physicsEnabled: true });
  dependency('./lib/plugins/generic_place.js')(bot);
  dependency('./lib/plugins/place_block.js')(bot);
  dependency('./lib/plugins/digging.js')(bot);
  // The local harness drives physics ticks; it has no network look interpolation loop.
  const look = bot.look.bind(bot);
  bot.look = (yaw, pitch) => look(yaw, pitch, true);
  function stock(name: string, count = 1, slot = 36) {
    const item = new Item(registry.itemsByName[name].id, count);
    item.slot = slot; bot.inventory.slots[slot] = item;
    bot.setQuickBarSlot(0); return item;
  }
  return { ...r, live: bot, packets, stock,
    receive: (fn: typeof receive) => { receive = fn; } };
}

async function until(check: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('condition timed out');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

describe('agent programs using Mineflayer public primitives', () => {
  it('reads real native water properties, preserves unknown blocks and computes positions with Vec3', async () => {
    const r = rig(); r.set(1, 64, 0, 'water');
    const blockAt = r.live.blockAt.bind(r.live);
    r.live.blockAt = at => at.x === 99 ? null : blockAt(at);
    const hold = r.exec.pauseForEnvironment('unrelated rescue');
    const run = r.runner.start({ name: 'native observations', code: `
      const b=await bot.blockAt(new Vec3(1,64,0));
      const unknown=await bot.blockAt(new Vec3(99,64,0));
      const type=await bot.read('registry.blocksByName.water');
      return {name:b.name,source:String(b.getProperties().level)==='0',below:b.position.offset(0,-1,0),unknown,type:type.id};` });
    expect(await methodEnded(r, run.id)).toMatchObject({ status: 'completed',
      result: { name: 'water', source: true, below: { x: 1, y: 63, z: 0 }, unknown: null, type: registry.blocksByName.water.id } });
    expect(r.exec.currentTask).toBeNull();
    expect(r.exec.status().hold).toContain('unrelated rescue');
    expect(r.runner.read(run.id)[0].trace[0].result).toMatchObject({ taskId: null, sampledAt: expect.any(String),
      value: { stateId: expect.any(Number), properties: { level: '0' } } });
    r.exec.resumeAfterEnvironment(hold);
  });

  it('holds native keys across calls, moves with real physics and releases them before queued work', async () => {
    const r = rig();
    const run = r.runner.start({ name: 'native movement', code: `
      const before=await bot.read('entity');
      await bot.setControlState('forward',true);
      await bot.waitForTicks(8);
      const after=await bot.read('entity');
      return {before:before.position,after:after.position,held:await bot.getControlState('forward')};` });
    await until(() => r.live.getControlState('forward'));
    r.exec.submit([{ skill: 'chat', text: 'after native movement' }], 'append');
    const ended = await methodEnded(r, run.id);
    expect(ended.status).toBe('completed');
    const result = ended.result as { before: { z: number }; after: { z: number }; held: boolean };
    expect(result.after.z).toBeLessThan(result.before.z - 0.5);
    expect(result.held).toBe(true);
    await until(() => r.said.length > 0);
    expect(r.live.getControlState('forward')).toBe(false);
    expect(r.said).toEqual(['after native movement']);
    expect(ended.trace[1].result).toMatchObject({ taskId: expect.any(Number), nativeMethod: 'setControlState' });
  });

  it('retains normal collision physics rather than walking through a wall', async () => {
    const r = rig(); r.set(0, 64, -1, 'stone'); r.set(0, 65, -1, 'stone');
    const run = r.runner.start({ name: 'collision observation', code: `
      await bot.setControlState('forward',true); await bot.waitForTicks(8);
      return (await bot.read('entity')).position;` });
    const ended = await methodEnded(r, run.id);
    expect(ended.status).toBe('completed');
    expect((ended.result as { z: number }).z).toBeGreaterThanOrEqual(0.29);
    await until(() => r.exec.currentTask === null);
    expect(r.live.getControlState('forward')).toBe(false);
  });

  it('uses the held bucket directly and verifies server inventory and block updates in the program', async () => {
    const r = rig(); r.stock('water_bucket');
    r.receive(name => {
      if (name !== 'use_item') return;
      const pitch = r.live.entity.pitch;
      if (pitch < -0.5 && r.live.heldItem?.name === 'water_bucket') {
        r.set(1, 64, 0, 'water'); r.stock('bucket');
      }
    });
    const run = r.runner.start({ name: 'native held item', code: `
      const before=await bot.read('heldItem');
      await bot.lookAt(new Vec3(1.5,63.99,0.5),true);
      await bot.activateItem();
      const at=await bot.blockAt(new Vec3(1,64,0));
      return {before:before.name,after:(await bot.read('heldItem')).name,source:at.name==='water'&&String(at.getProperties().level)==='0'};` });
    expect(await methodEnded(r, run.id)).toMatchObject({ status: 'completed', result: { before: 'water_bucket', after: 'bucket', source: true } });
    expect(r.packets.filter(p => p.name === 'use_item').map(p => p.hand)).toEqual(['water_bucket']);
  });

  it('preserves native cursor coordinates and current hand through the navigation adapter', async () => {
    const r = rig(); r.stock('torch'); r.set(1, 64, 0, 'oak_door');
    installNavigationBareHand(r.live);
    const run = r.runner.start({ name: 'native cursor', code: `
      const block=await bot.blockAt(new Vec3(1,64,0));
      await bot.activateBlock(block,new Vec3(1,0,0),new Vec3(1,0.25,0.75));
      return (await bot.read('heldItem')).name;` });
    expect(await methodEnded(r, run.id)).toMatchObject({ status: 'completed', result: 'torch' });
    expect(r.packets.find(p => p.name === 'block_place')).toMatchObject({ hand: 'torch',
      value: { direction: 5, cursorX: 1, cursorY: 0.25, cursorZ: 0.75 } });
    expect(r.live.inventory.items().map(item => item.name)).toEqual(['torch']);
  });

  it('places using the native reference plus face and reads the actual changed cell', async () => {
    const r = rig(); r.stock('cobblestone', 2);
    r.receive((name, packet) => {
      if (name !== 'block_place') return;
      const p = packet.location as Vec3;
      if (packet.direction !== 1 || r.live.heldItem?.name !== 'cobblestone') return;
      const at = p.offset(0, 1, 0), old = r.live.blockAt(at);
      r.set(at.x, at.y, at.z, 'cobblestone');
      r.live.emit(`blockUpdate:${at}` as 'blockUpdate', old, r.live.blockAt(at)!);
    });
    const run = r.runner.start({ name: 'native placement', code: `
      const reference=await bot.blockAt(new Vec3(1,63,0));
      await bot.placeBlock(reference,new Vec3(0,1,0));
      return (await bot.blockAt(reference.position.offset(0,1,0))).name;` });
    expect(await methodEnded(r, run.id)).toMatchObject({ status: 'completed', result: 'cobblestone' });
    expect(r.live.blockAt(new Vec3(1, 64, 0))!.name).toBe('cobblestone');
    expect(r.live.blockAt(new Vec3(1, 65, 0))!.name).toBe('air');
  });

  it('refuses a changed block and protected digging without modifying the world', async () => {
    const r = rig();
    Object.assign(r.live, { cortiBreakVerdict: () => 'protected' });
    const run = r.runner.start({ name: 'native preconditions', code: `
      const target=await bot.blockAt(new Vec3(1,63,0));
      let protectedReason,staleReason;
      try{await bot.dig(target)}catch(e){protectedReason=e.message}
      try{await bot.activateBlock({...target,stateId:-1})}catch(e){staleReason=e.message}
      return {protectedReason,staleReason,block:(await bot.blockAt(target.position)).name};` });
    expect(await methodEnded(r, run.id)).toMatchObject({ status: 'completed', result: {
      protectedReason: expect.stringContaining('受保护'), staleReason: expect.stringContaining('已变化'), block: 'stone' } });
    expect(r.packets.filter(p => ['block_dig', 'block_place'].includes(p.name))).toEqual([]);
  });

  it('cancels a queued native program without releasing an unrelated rescue hold', async () => {
    const r = rig(); const hold = r.exec.pauseForEnvironment('rescue');
    const run = r.runner.start({ name: 'queued native', code: `await bot.setControlState('forward',true);` });
    await until(() => r.exec.status().waiting.length === 1);
    r.runner.stop('new goal');
    expect((await methodEnded(r, run.id)).status).toBe('cancelled');
    expect(r.exec.status().waiting).toEqual([]);
    expect(r.exec.status().hold).toContain('rescue');
    expect(r.live.getControlState('forward')).toBe(false);
    r.exec.resumeAfterEnvironment(hold);
  });

  it.each(['forcedMove', 'death', 'end'] as const)('revokes native body ownership on %s without replay', async event => {
    const r = rig();
    const run = r.runner.start({ name: 'interrupted native', code: `
      await bot.setControlState('forward',true); await bot.waitForTicks(20);` });
    await until(() => r.live.getControlState('forward'));
    if (event === 'end') r.live.emit('end', 'test disconnection');
    else r.live.emit(event);
    expect((await methodEnded(r, run.id)).status).toBe('cancelled');
    expect(r.live.getControlState('forward')).toBe(false);
    expect(r.exec.status().waiting).toEqual([]);
    expect(r.exec.status().running).toBeNull();
  });

  it('revokes a native program when combat takes the body and keeps its actions out of the frozen queue', async () => {
    const r = rig();
    const run = r.runner.start({ name: 'native combat interruption', code: `
      await bot.setControlState('forward',true); await bot.waitForTicks(20);` });
    await until(() => r.live.getControlState('forward'));
    r.exec.suspend('combat', 'combat');
    expect((await methodEnded(r, run.id)).status).toBe('cancelled');
    expect(r.exec.status().waiting).toEqual([]);
    expect(r.live.getControlState('forward')).toBe(false);
  });

  it('blocks a delayed native packet after cancellation while another task still executes', async () => {
    const r = rig(); r.stock('torch');
    let resume!: () => void, entered = false;
    r.live.lookAt = async () => { entered = true; await new Promise<void>(resolve => { resume = resolve; }); };
    const run = r.runner.start({ name: 'late native send', code: `
      await bot.activateBlock(await bot.blockAt(new Vec3(1,63,0)));` });
    await until(() => entered);
    r.runner.stop('new goal'); r.exec.submit([{ skill: 'chat', text: 'next' }], 'append'); resume();
    await until(() => r.said.length > 0);
    expect((await methodEnded(r, run.id)).status).toBe('cancelled');
    expect(r.packets.filter(p => p.name === 'block_place')).toEqual([]);
    expect(r.said).toEqual(['next']);
  });

  it.each([false, true])('shuts down a queued/running native program once without recursive cancellation: queued=%s', async queued => {
    const r = rig();
    if (queued) r.exec.pauseForEnvironment('rescue');
    const run = r.runner.start({ name: 'native shutdown', code: `
      await bot.setControlState('forward',true); await bot.waitForTicks(20);` });
    await until(() => queued ? r.exec.status().waiting.length === 1 : r.live.getControlState('forward'));
    const status = r.exec.status();
    const taskId = status.running?.id ?? status.waiting[0].id;
    r.exec.shutdown();
    expect((await methodEnded(r, run.id)).status).toBe('cancelled');
    expect(r.live.getControlState('forward')).toBe(false);
    expect(r.exec.status().waiting).toEqual([]);
    expect(r.exec.status().running).toBeNull();
    expect(r.host.events.filter(e => e.type === 'minecraft.task'
      && e.text.includes(`任务#${taskId}没做完`))).toHaveLength(1);
  });

  it('rejects nested executor work and private reads, and exposes the native guide without a connection', async () => {
    const r = rig();
    const run = r.runner.start({ name: 'native capability bounds', code: `
      await bot.look(0,0,true);
      let nested,privateRead;
      try{await mc.do([{skill:'chat',text:'nested'}])}catch(e){nested=e.message}
      try{await bot.read('_client')}catch(e){privateRead=e.message}
      return {nested,privateRead,privateField:typeof bot._client,process:typeof process};` });
    expect(await methodEnded(r, run.id)).toMatchObject({ status: 'completed', result: {
      nested: expect.stringContaining('等待自身'), privateRead: expect.stringContaining('公开字段'),
      privateField: 'undefined', process: 'undefined' } });
    expect(r.said).toEqual([]);
    const tool = r.world.tools().find(tool => tool.name === 'mc_script')!;
    expect(await tool.handler({ api: 'activateItem' }, {} as never)).toContain('Does not clear/equip');
    expect(tool.description).toContain('api:"index"');
  });
});
