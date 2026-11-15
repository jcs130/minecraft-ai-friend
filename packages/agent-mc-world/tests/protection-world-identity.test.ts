import type { Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { expect, it } from 'vitest';
import { Bridge } from '../core/bridge.ts';
import { installPathfinderPerf } from '../core/pathfinder-perf.ts';
import { installWorldIdentity } from '../core/world-scope.ts';
import { parseServerActionDenial } from '../core/server-feedback.ts';
import { methodHarness } from './method-harness.ts';

it('uses the native level for exact-cell denials and never applies them to another level with the same physics type', () => {
  const h = methodHarness('1.21.1'), bot = h.bot as unknown as Bot;
  const dispose = installWorldIdentity(bot);
  try {
    bot._client.emit('login', { worldState: { name: 'minecraft:fixture_temple', dimension: 0 } });
    h.set(2, 64, 0, 'stone');
    pathfinderPkg.pathfinder(bot); installPathfinderPerf();
    class FixtureBridge extends Bridge {
      attach() { this._bot = bot; this.applyTuning(bot, bot.pathfinder.movements); }
      verdict(world: string) { return this.protection.verdict(world, 2, 64, 0, h.bot.registry.blocksByName.stone.id); }
      placement(world: string) { return this.observedPlaceDenial(world, { x: 2, y: 64, z: 0 }); }
    }
    const bridge = new FixtureBridge({ host: 'fixture.invalid', port: 25565, username: 'Fixture', version: '1.21.1',
      viewerPort: 0, log: h.host.log, onSpawn() {}, onDisconnect() {} });
    bridge.attach();
    const deny = (action: 'break' | 'place', world = 'minecraft:fixture_temple') => parseServerActionDenial('MC_PROTECTION ' + JSON.stringify({
      action, world, x: 2, y: 64, z: 0, status: 'deny', allowed: false, reason: 'generated_structure', retrySameAction: false,
    }))!;
    bridge.noteServerActionDenied(deny('break'));
    bridge.noteServerActionDenied(deny('place'));
    expect(bridge.verdict('fixture_temple')).toBe('protected');
    expect(bridge.placement('fixture_temple')?.status).toBe('deny');
    expect(bridge.verdict('overworld')).toBe('allowed');
    const stone = bot.blockAt(new Vec3(2, 64, 0))!;
    const movements = bot.pathfinder.movements;
    expect(movements.safeToBreak(stone)).toBe(false);
    // The existing movement object must observe the new world without a stale captured key.
    bot._client.emit('respawn', { worldState: { name: 'minecraft:fixture_garden', dimension: 0 } });
    expect(bot.game.dimension).toBe('overworld');
    expect(movements.safeToBreak(stone)).toBe(true);
    bridge.noteServerActionDenied(deny('break')); // late old-world reply
    bridge.noteServerActionDenied(deny('place'));
    expect(bridge.verdict('fixture_garden')).toBe('allowed');
    expect(bridge.placement('fixture_garden')).toBeNull();
    bridge.noteServerActionDenied(deny('break', 'minecraft:overworld')); // physics type is not an alias
    expect(movements.safeToBreak(stone)).toBe(true);
    bot._client.emit('respawn', { worldState: { name: 'minecraft:fixture_temple', dimension: 0 } });
    expect(movements.safeToBreak(stone)).toBe(false);
  } finally { dispose(); h.close(); }
});
