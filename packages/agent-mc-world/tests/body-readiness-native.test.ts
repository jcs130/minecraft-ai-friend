import '../core/dependency-patches.ts';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { afterEach, expect, it, vi } from 'vitest';
import { installNativeBodyReadiness } from '../core/body-readiness.ts';
import { methodHarness } from './method-harness.ts';
import type { Bot } from 'mineflayer';
import { Executor, type TaskReport } from '../core/executor.ts';
import { Vec3 } from 'vec3';
import { rideDrive } from '../core/skills-interact.ts';

const req = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it.each([false, true])('drives after real set_passengers over deep water with mount before first position=%s', async mountFirst => {
  vi.useFakeTimers(); vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  const h = methodHarness('1.21.1'); h.close(); const b = h.bot as unknown as Bot;
  for (let x=-1;x<=6;x++) for (let z=-1;z<=1;z++) for (let y=30;y<64;y++) h.set(x,y,z,'water');
  Object.assign(b, { supportFeature: b.registry.supportFeature });
  const self = b.entity;
  req('mineflayer/lib/plugins/entities.js')(b);
  b.entity = self; b.entities[self.id] = self;
  const boat = { id: 9, name: 'boat', isValid: true, passengers: [], position: new Vec3(.5,64,.5), width: 1.4, height: .6 };
  b.entities[9] = boat as never;
  const observer = installNativeBodyReadiness(b);
  req('mineflayer/lib/plugins/physics.js')(b, { physicsEnabled: true });
  const write = vi.spyOn(b._client,'write');
  try {
    b.emit('login');
    if (mountFirst) {
      b._client.emit('set_passengers', { entityId:9,passengers:[self.id] });
      expect(observer.read().phase).toBe('waiting-position');
    }
    b._client.emit('position', { x:.5,y:64,z:.5,yaw:0,pitch:0,flags:0,teleportId:1 });
    await vi.advanceTimersByTimeAsync(100);
    if (!mountFirst) b._client.emit('set_passengers', { entityId:9,passengers:[self.id] });
    const mountedY=b.entity.position.y;
    await vi.advanceTimersByTimeAsync(6000);
    expect(observer.read()).toMatchObject({ phase:'mounted',vehicleId:9 });
    // A mounted passenger must not run walking physics and sink away from its boat.
    expect(b.entity.position.y).toBeCloseTo(mountedY, 3);
    const driving = rideDrive(b,{aborted:()=>false} as never,{x:5,y:64,z:0});
    await vi.advanceTimersByTimeAsync(2000);
    expect(await driving).toContain('人还骑着');
    expect(boat.position.x).toBeGreaterThan(3);
    expect(write.mock.calls.some(([name])=>name==='vehicle_move')).toBe(true);
    b._client.emit('set_passengers', {entityId:9,passengers:[]});
    b._client.emit('position', {x:8.5,y:64,z:.5,yaw:0,pitch:0,flags:0,teleportId:2});
    await vi.advanceTimersByTimeAsync(100);
    expect(observer.read().phase).toBe('ready');
    const ashore=b.entity.position.clone(); b.setControlState('forward',true);
    await vi.advanceTimersByTimeAsync(500);
    expect(b.entity.position.distanceTo(ashore)).toBeGreaterThan(.1);
    b.emit('death'); b.emit('respawn');
    expect(observer.read().phase).toBe('waiting-position');
  } finally { b.emit('end'); observer.dispose(); }
});
it('does not enable walking when a delayed respawn position is confirmed after mounting', async () => {
  vi.useFakeTimers(); vi.spyOn(performance,'now').mockImplementation(()=>Date.now());
  const h=methodHarness('1.21.1');h.close();const b=h.bot as unknown as Bot;
  for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++)for(let y=30;y<64;y++)h.set(x,y,z,'water');
  Object.assign(b,{supportFeature:b.registry.supportFeature});const self=b.entity;
  req('mineflayer/lib/plugins/entities.js')(b);b.entity=self;b.entities[self.id]=self;
  b.entities[9]={id:9,name:'boat',isValid:true,passengers:[],position:new Vec3(.5,64,.5)} as never;
  req('mineflayer/lib/plugins/physics.js')(b,{physicsEnabled:true});
  const write=vi.spyOn(b._client,'write');
  try{
    b.emit('login');b.emit('death');b.emit('respawn');
    b._client.emit('position',{x:.5,y:64,z:.5,yaw:0,pitch:0,flags:0,teleportId:10});
    b._client.emit('set_passengers',{entityId:9,passengers:[self.id]});
    await vi.advanceTimersByTimeAsync(6000);
    expect(b.entity.position.y).toBeCloseTo(64,3);
    expect(write.mock.calls.filter(([name])=>name==='teleport_confirm')).toHaveLength(1);
    expect(write.mock.calls.some(([name])=>name==='position_look')).toBe(true);
  }finally{b.emit('end');}
});
it.each([false, true])('keeps missing-body work blocked despite an explicit old-position expectation=%s, while retaining chat', async explicit => {
  vi.useFakeTimers();
  const r = methodHarness('1.21.1'); r.close();
  const observer = installNativeBodyReadiness(r.bot), reports: TaskReport[] = [];
  const exec = new Executor({ getBot: () => r.bot as unknown as Bot, report: value => reports.push(value),
    log: r.host.log, nextId: (() => { let n = 0; return () => ++n; })() });
  try {
    exec.submit([{ skill: 'goto', at: [10, 64, 0], ...(explicit ? {expect:{near:[0,64,0] as [number,number,number],within:2}} : {}) }], 'append');
    exec.submit([{ skill: 'chat', text: 'fixture chat remains available' }], 'append');
    await vi.advanceTimersByTimeAsync(1000);
    expect(reports.find(value => value.taskId === 1 && value.kind === 'blocked')?.text).toContain('本步未执行');
    expect(reports.find(value => value.taskId === 2)?.kind).toBe('done');
    expect(r.said).toEqual(['fixture chat remains available']);
    expect(r.bot.entity.position.x).toBe(.5);
  } finally { exec.shutdown(); observer.dispose(); }
});
it('reproduces the frozen positive-health body using real pinned 1.21.1 health and physics plugins, then accepts a real new position', async () => {
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  const r = methodHarness('1.21.1'), b = r.bot as unknown as Bot;
  // Stop the harness's timer/executor; keep its local collision grid and entity.
  // Only Mineflayer's actual physics plugin may advance the body in this test.
  r.close();
  Object.assign(b, { supportFeature: (name: string) => b.registry.supportFeature(name) });
  const observer = installNativeBodyReadiness(b);
  req('mineflayer/lib/plugins/health.js')(b, { respawn: false });
  req('mineflayer/lib/plugins/physics.js')(b, { physicsEnabled: true });
  const health = (value: number) => b._client.emit('update_health', { health: value, food: 20, foodSaturation: 5 });
  const land = (x: number) => b._client.emit('position', { x, y: 64, z: .5, yaw: 0, pitch: 0,
    flags: { x: false, y: false, z: false, yaw: false, pitch: false }, teleportId: 1 });
  // Use the plugin's native event as proof, not the harness's simulated ticker.
  let nativeTicks = 0;
  b.on('physicsTick', () => nativeTicks++);
  try {
    b.emit('login'); health(35); land(.5); await vi.advanceTimersByTimeAsync(100);
    health(0); b._client.emit('respawn', {}); health(35);
    const before = b.entity.position.clone();
    b.setControlState('forward', true); await vi.advanceTimersByTimeAsync(3000);
    expect(b.entity.position.distanceTo(before)).toBeLessThan(.001);
    expect(observer.read().phase).toBe('waiting-position');
    b.setControlState('forward', false);
    land(10.5); await vi.advanceTimersByTimeAsync(2200);
    expect(observer.read().phase).toBe('ready');
    b.setControlState('forward', true); const fresh = b.entity.position.clone();
    await vi.advanceTimersByTimeAsync(500);
    expect(b.entity.position.distanceTo(fresh)).toBeGreaterThan(.1);
    expect(nativeTicks).toBeGreaterThan(0);
  } finally { b.emit('end'); observer.dispose(); }
});
