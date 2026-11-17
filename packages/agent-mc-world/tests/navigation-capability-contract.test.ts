import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import { Movements } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { Bridge } from '../core/bridge.ts';
import { readSkillHelp } from '../core/skills.ts';
import { renderRouteMenu } from '../core/travel.ts';
import { nullLogger } from '../src/client/index.ts';

describe('configured navigation capability disclosure', () => {
  it('labels computed routes as unexecuted plans even in a failure readout',()=>{
    const text=renderRouteMenu([{profile:'walk',status:'complete',steps:9,place:0,breaks:0,interact:0} as any],
      {x:0,y:64,z:9},{head:'After a blocked attempt:'});
    expect(text).toContain('未执行');expect(text).toContain('规划路点 9 个');expect(text).not.toContain('走 9 步');
  });
  it.each([0, 7])('keeps shared tuning unchanged and reports actual dig/scaffold availability (%i blocks)', count => {
    const require = createRequire(import.meta.url);
    const registry = require('minecraft-data')('1.21.1');
    const probed: Movements[] = [];
    const inventory = [{ type: registry.itemsByName.dirt.id, count }];
    const bot = { registry, entity: { position: new Vec3(0.5, 64, 0.5) }, inventory: { items: () => inventory },
      blockAt: () => null, entities: {}, pathfinder: {
        *getPathFromTo(movements: Movements) { probed.push(movements); yield { result: { status: 'noPath', path: [], visitedNodes: 3 } }; },
      } } as unknown as Bot;
    class ProbeBridge extends Bridge {
      attach() { this._bot = bot; }
      tune(movements: Movements) { this.applyTuning(bot, movements); }
    }
    const bridge = new ProbeBridge({ host: 'fixture.test', port: 25565, username: 'offline', version: '1.21.1', viewerPort: 0,
      log: nullLogger, onSnapshot() {}, onEvent() {}, onMessage() {} } as never);
    bridge.attach();
    const live = new Movements(bot);
    bridge.tune(live);
    expect(live.maxDropDown).toBe(3);
    expect(live.allowParkour).toBe(true);
    const probes = bridge.probeRoutes({ x: 10, y: 59, z: 0 })!;
    expect(probed).toHaveLength(3);
    for (const [index, probe] of probes.entries()) {
      expect(probed[index].maxDropDown).toBe(live.maxDropDown);
      expect(probed[index].allowParkour).toBe(live.allowParkour);
      expect(probe.capabilities).toMatchObject({ maxDropDown: 3, allowParkour: true, jumpMode: 'gap',
        canDig: probe.profile !== 'walk', scaffoldCount: probe.profile === 'style' ? count : 0,
        fall:{health:null,damageBudget:0} });
    }
    const text = renderRouteMenu(probes, { x: 10, y: 59, z: 0 });
    expect(text).toContain('规划落差≤3格');
    expect(text).toContain('跑酷仅同高一格跨空');
    expect(text).toContain(`垫脚料${count}块`);
    expect(text).toContain('挖掘关闭');
    expect(text).toContain('仅表示在所列能力下未找到路线');
    expect(text).not.toContain('因为落差');
    expect(text).not.toContain('没有任何路');
  });

  it('explains health-aware fall costs and evidence boundaries in public goto help', () => {
    const help = readSkillHelp({ skill: 'goto' });
    if (!('text' in help)) throw new Error('Missing goto help');
    expect(help.text).toContain('累计预期摔伤');
    expect(help.text).toContain('mc_policy.fall=safe');
    expect(help.text).toContain('mc_policy.jump 默认 gap');
    expect(help.text).toContain('三种路线试算共享');
    expect(help.text).toContain('背包内可用垫脚料');
    expect(help.text).toContain('不证明所有移动方式或显式改结构都不可行');
  });

  it('runs only the requested distinct route profiles without changing live movements', () => {
    const require = createRequire(import.meta.url), registry = require('minecraft-data')('1.21.1');
    const profiles: boolean[] = [];
    const bot = { registry, entity: { position: new Vec3(.5, 64, .5) }, inventory: { items: () => [] },
      blockAt: () => null, entities: {}, pathfinder: { movements: { canDig: true },
        *getPathFromTo(movements: Movements) { profiles.push(movements.canDig); yield { result: { status: 'noPath', path: [], visitedNodes: 2 } }; } } } as unknown as Bot;
    class FixtureBridge extends Bridge { attach() { this._bot = bot; } }
    const bridge = new FixtureBridge({ host: 'fixture.invalid', port: 25565, username: 'Fixture', log: nullLogger(),
      onSnapshot() {}, onEvent() {}, onMessage() {} } as never);
    bridge.attach();
    expect(bridge.probeRoutes({ x: 10, y: 64, z: 0 }, undefined, ['walk', 'walk'])?.map(p => p.profile)).toEqual(['walk']);
    expect(profiles).toEqual([false]); expect(bot.pathfinder.movements.canDig).toBe(true);
  });
});
