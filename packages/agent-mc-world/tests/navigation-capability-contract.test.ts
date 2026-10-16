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
    expect(live.maxDropDown).toBe(2);
    expect(live.allowParkour).toBe(false);
    const probes = bridge.probeRoutes({ x: 10, y: 59, z: 0 })!;
    expect(probed).toHaveLength(3);
    for (const [index, probe] of probes.entries()) {
      expect(probed[index].maxDropDown).toBe(live.maxDropDown);
      expect(probed[index].allowParkour).toBe(live.allowParkour);
      expect(probe).toHaveProperty('capabilities', { maxDropDown: 2, allowParkour: false,
        canDig: probe.profile !== 'walk', scaffoldCount: probe.profile === 'style' ? count : 0 });
    }
    const text = renderRouteMenu(probes, { x: 10, y: 59, z: 0 });
    expect(text).toContain('规划落差≤2格、跑酷关闭');
    expect(text).toContain(`垫脚料${count}块`);
    expect(text).toContain('挖掘关闭');
    expect(text).toContain('仅表示在所列能力下未找到路线');
    expect(text).not.toContain('因为落差');
    expect(text).not.toContain('没有任何路');
  });

  it('explains the same fixed limits and evidence boundaries in public goto help', () => {
    const help = readSkillHelp({ skill: 'goto' });
    if (!('text' in help)) throw new Error('Missing goto help');
    expect(help.text).toContain('规划落差最多 2 格');
    expect(help.text).toContain('跑酷关闭');
    expect(help.text).toContain('三种路线试算共享');
    expect(help.text).toContain('背包内可用垫脚料');
    expect(help.text).toContain('不证明所有移动方式或显式改结构都不可行');
  });
});
