import { Vec3 } from 'vec3';
import { afterEach, expect, it, vi } from 'vitest';
import { MinecraftWorld } from '../core/world.ts';
import { MINECRAFT_CLIENT_DEFAULTS, nullLogger } from '../src/client/index.ts';
import type { WorldHost } from '../src/contracts/host.ts';
const fixture = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock('../core/visual-capture.ts', async original => ({ ...await original<typeof import('../core/visual-capture.ts')>(), captureMinecraftView: fixture.capture }));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6NQAAAABJRU5ErkJggg==', 'base64');
class OfflineWorld extends MinecraftWorld {
  readonly actor = { username: 'Fixture', entity: { position: new Vec3(2, 65, 7), yaw: 0.3, pitch: -0.4 }, game: { dimension: 'overworld' }, blockAt: () => null };
  constructor() {
    super({ cfg: { ...structuredClone(MINECRAFT_CLIENT_DEFAULTS), host: 'offline.invalid', username: 'Fixture' } });
    this.bridge = { bot: this.actor, viewerUrl: 'http://offline-viewer.invalid', viewerKind: 'modern', connected: true } as any;
    this.host = { log: nullLogger() } as WorldHost;
    this.photography.start(this.host);
  }
  protected override snapshot() { return { position: { x: 2, y: 65, z: 7 }, dimension: this.actor.game.dimension, inventory: [{ name: 'stone', count: 4 }], entities: [] } as any; }
  readVisual(args: Record<string, unknown>) { return this.visualReadout(args, { role: 'Fixture', callId: 'visual', log: nullLogger() }); }
  closeFixture() { this.photography.stop(); }
}
afterEach(() => vi.clearAllMocks());
it('wires the actual World photo tool to a HUD-free frame and immediate game readings', async () => {
  const world = new OfflineWorld();
  fixture.capture.mockImplementationOnce(async () => {
    world.actor.entity.position.x += 3;
    return { png, mode: 'third', fov: 75, capturedAt: new Date().toISOString(), width: 1200, height: 800 };
  });
  try {
    const tool = world.tools().find(tool => tool.name === 'mc_photo')!;
    const outcome = await tool.handler({ action: 'capture', mode: 'third', fov: 75 }, { role: 'Fixture', callId: 'world-photo', log: nullLogger() }) as any;
    expect(outcome.failed).not.toBe(true);
    expect(JSON.parse(outcome.text).facts).toMatchObject({ server: { host: 'offline.invalid' }, account: 'Fixture',
      snapshot: { inventory: [{ name: 'stone', count: 4 }] }, movedDuringCapture: 3, camera: { mode: 'third', sampledPitch: -0.4 } });
    expect(fixture.capture).toHaveBeenCalledWith(expect.objectContaining({ includeHud: false, fov: 75, mode: 'third' }));
    expect(Buffer.from(outcome.blobs[0].bytes)).toEqual(png);
  } finally { world.closeFixture(); }
});
it('rejects a frame if the game dimension changed before its state could be paired', async () => {
  const world = new OfflineWorld();
  fixture.capture.mockImplementationOnce(async () => {
    world.actor.game.dimension = 'the_nether';
    return { png, capturedAt: new Date().toISOString() };
  });
  try {
    const outcome = await world.tools().find(tool => tool.name === 'mc_photo')!.handler({ action: 'capture' }, { role: 'Fixture', callId: 'changed', log: nullLogger() }) as any;
    expect(outcome.failed).toBe(true); expect(outcome.text).toContain('dimension changed'); expect(outcome.blobs).toBeUndefined();
  } finally { world.closeFixture(); }
});

it.each(['dungeon', '3dview'])('normalizes %s at the actual World visual and photograph boundaries', async mode => {
 const world=new OfflineWorld();
 fixture.capture.mockImplementation(async args => ({png,mode:args.mode,capturedAt:new Date().toISOString(),width:1200,height:800}));
 try {
  const visual=await world.readVisual({mode});
  expect(visual.failed).not.toBe(true);expect(visual.text).toContain('3dview 视角');
  expect(visual.blobs?.[0].name).toMatch(/^minecraft-3dview-/);
  expect(fixture.capture).toHaveBeenLastCalledWith(expect.objectContaining({mode:'3dview'}));
  const photo=await world.tools().find(t=>t.name==='mc_photo')!.handler({action:'capture',mode},{role:'Fixture',callId:'legacy-photo',log:nullLogger()}) as any;
  expect(photo.failed).not.toBe(true);expect(JSON.parse(photo.text).facts.camera.mode).toBe('3dview');
  expect(fixture.capture).toHaveBeenLastCalledWith(expect.objectContaining({mode:'3dview'}));
 } finally {world.closeFixture();}
});
