import { expect, it, vi } from 'vitest';
import { installNativeBodyReadiness } from '../core/body-readiness.ts';
import { installDeathLifecycle } from '../core/death-lifecycle.ts';
import { methodHarness } from './method-harness.ts';

it('keeps online, health and one death episode distinct from missing respawn position', () => {
  const r = methodHarness('1.21.1'); r.close();
  const body = installNativeBodyReadiness(r.bot as any);
  const recovery = installDeathLifecycle(r.bot as any, 4000, () => true);
  try {
    r.bot._client.emit('position', {}); r.bot.emit('physicsTick');
    r.bot.health = 0; r.bot.emit('death'); r.bot.emit('respawn');
    r.bot._client.emit('update_health', { health: 35, food: 20 });
    r.bot.health = 35; r.bot.emit('spawn');
    const facts = r.world.requestFacts()!;
    const get = (key: string) => JSON.parse(facts.parts!.find(p => p.key === key)!.text);
    expect(get('availability')).toMatchObject({ reason: 'body-not-ready', position: null, health: 35, food: 20 });
    expect(get('deathLifecycle')).toMatchObject({ phase: 'alive', healthObservation: { health: 35 } });
    expect(facts.text).toContain('不表示服务器断线');
    expect(body.read().phase).toBe('waiting-position');
    r.bot.emit('respawn'); // New spatial boundary invalidates the prior health observation's currentness.
    // A later boundary at a later clock must not promote the old packet.
    const life = (r.bot as any).deathLifecycle;
    life.healthObservation.observedAt = new Date(body.read().boundaryAt - 1).toISOString();
    expect(JSON.parse(r.world.requestFacts()!.parts!.find(p => p.key === 'availability')!.text).health).toBeNull();
  } finally { body.dispose(); recovery.dispose(); }
});

it('removes stale death coordinates from current request facts while retaining the goal and terminal history', async () => {
  const r = methodHarness('1.21.1');
  const observer = installNativeBodyReadiness(r.bot as any);
  const land = () => { r.bot._client.emit('position', {}); r.bot.emit('physicsTick'); };
  try {
    land();
    await r.world.tools().find(tool => tool.name === 'mc_goal')!.handler({ add: { text: 'Reach the mine',
      plan: [{ do: 'Find the entrance', judgment: 'Verified arrival' }] } }, { role: 'test', log: r.host.log });
    const world = r.world as any;
    world.lastFinishedTask = { kind: 'blocked', at: Date.now(), text: 'task#63 no observed movement' };
    expect(r.world.requestFacts()?.decision?.state).toHaveProperty('position');
    r.bot.emit('death'); r.bot.emit('respawn'); r.bot.health = 35; r.bot.emit('spawn');
    const snapshot = vi.spyOn(world, 'snapshot');
    const facts = r.world.requestFacts()!;
    expect(snapshot.mock.calls.length).toBe(0);
    const availability = JSON.parse(facts.parts!.find(part => part.key === 'availability')!.text);
    expect(availability).toMatchObject({ reason: 'body-not-ready', currentWorldVerified: false,
      position: null, dimension: null, nearby: null, nativeBody: { phase: 'waiting-position', boundary: 'respawn' } });
    expect(facts.text).toContain('Reach the mine');
    expect(facts.text).toContain('task#63 no observed movement');
    expect(facts.text).toContain('旧坐标不是当前落点');
    for (const key of ['decision', 'decisionStability', 'experience', 'options']) expect(facts).not.toHaveProperty(key);
    snapshot.mockRestore();
    land();
    expect(r.world.requestFacts()?.decision?.state).toHaveProperty('position');
  } finally { observer.dispose(); r.close(); }
});

it('renders an explicit unavailable snapshot instead of the old place during respawn', () => {
  const r = methodHarness('1.21.1');
  const observer = installNativeBodyReadiness(r.bot as any);
  try {
    const world = r.world as any;
    r.bot._client.emit('position', {}); r.bot.emit('physicsTick');
    r.bot.emit('death'); r.bot.emit('respawn'); r.bot.health = 35; r.bot.emit('spawn');
    const snapshot = vi.spyOn(world, 'snapshot');
    const text = world.renderSnapshotEvent();
    expect(snapshot.mock.calls.length).toBe(0);
    expect(text).toContain('body-not-ready');
    expect(text).toContain('旧坐标不是当前落点');
    expect(text).not.toContain('站在格');
    expect(world.requestFactsCache?.text).toContain('body-not-ready');
  } finally { observer.dispose(); r.close(); }
});

it('does not describe entities, gestures or nearby blocks using a stale body position', () => {
  const r = methodHarness('1.21.1');
  const observer = installNativeBodyReadiness(r.bot as any);
  try {
    const world = r.world as any;
    const sample = vi.spyOn(world.playerObservations, 'sample');
    const gesture = vi.spyOn(world.playerObservations, 'gesture');
    const block = vi.spyOn(r.bot, 'blockAt');
    world.proximityTick(r.bot);
    world.playerProximityTick(r.bot);
    world.notePlayerGesture(r.bot, { id: 7 }, 'wave');
    expect(sample.mock.calls.length).toBe(0);
    expect(gesture.mock.calls.length).toBe(0);
    expect(block.mock.calls.length).toBe(0);
    expect(world.snapshot()).toBeNull();
  } finally { observer.dispose(); r.close(); }
});
