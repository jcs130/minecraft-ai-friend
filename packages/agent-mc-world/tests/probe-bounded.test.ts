import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it, vi } from 'vitest';
import { skillProbe } from '../core/skills-gather.ts';
import { shapeCells, BUILD_CELL_CAP, EXCAVATE_CELL_CAP } from '../core/cell-facts.ts';
import type { SkillContext } from '../core/skill-context.ts';
import { parseScoutSteps } from '../core/skills.ts';
import { probePage } from '../core/probe-page.ts';

vi.mock('../core/perception-sight.ts', async load => ({ ...await load<typeof import('../core/perception-sight.ts')>(), observationView: (bot: Bot) => bot }));
const require = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = require('minecraft-data')('1.21.1');
function scene() {
  const sampled = new Set<string>();
  const bot = Object.assign(new EventEmitter(), {
    registry, entities: {}, game: { dimension: 'overworld' },
    entity: { position: new Vec3(0,64,0) },
    blockAt(p: Vec3) {
      sampled.add(p.toString());
      if (p.x === 1) return null;
      return { name: 'stone', position: p.floored(), boundingBox: 'block', shapes: [[0,0,0,1,1,1]], getProperties: () => ({}) };
    },
  }) as unknown as Bot;
  return {bot, sampled, ctx: {aborted: () => false, probeMemo: {last: null, entries: new Map()}} as SkillContext};
}
const volume = (b: number[]) => (b[3]-b[0]+1)*(b[4]-b[1]+1)*(b[5]-b[2]+1);
describe('bounded probe data before a scan budget warning', () => {
  it('returns filtered evidence and honest unread coverage for the real oversized box', async () => {
    const {bot, sampled, ctx} = scene();
    const call = {skill: 'probe' as const, shape: 'box' as const, anchors: [[0,64,0],[32,82,32]] as [number,number,number][], where: ['stone']};
    const original = structuredClone(call);
    const result = JSON.parse(await skillProbe(bot, call, ctx));
    expect(result).toMatchObject({kind: 'probe', status: 'partial', complete: false, reason: 'cell_budget'});
    expect(result.coverage.requestedCount).toBe(20691);
    expect(result.coverage.returnedCount).toBeGreaterThan(0);
    expect(result.coverage.returnedCount).toBeLessThanOrEqual(8192);
    expect(result.coverage.observedCount).toBeGreaterThan(0);
    expect(result.coverage.unknownCount).toBeGreaterThan(0);
    expect(result.coverage.observedCount+result.coverage.unknownCount).toBe(result.coverage.returnedCount);
    expect(result.result).toContain('石头');
    expect(result.result).not.toContain('尚未读取');
    expect(result.coverage.remainingRegions.reduce((n:number,b:number[]) => n+volume(b), 0)).toBe(20691-result.coverage.returnedCount);
    expect(sampled.size).toBe(result.coverage.returnedCount);
    expect(call).toEqual(original);
    expect(result.next.length).toBeGreaterThan(0);
    for (const next of result.next) expect(next.arguments.steps[0].where).toEqual(['stone']);
    for (const next of result.next) expect(parseScoutSteps(next.arguments.steps)).not.toHaveProperty('error');
    bot.entity.position = new Vec3(100,80,100);
    expect(result.next[0].arguments.steps[0].anchors.flat().every(Number.isFinite)).toBe(true);
    const repeated = JSON.parse(await skillProbe(bot, call, ctx));
    expect(repeated.coverage.remainingCount).toBe(result.coverage.remainingCount);
  });
  it.each([undefined, 'y'] as const)('bounds a plain or sliced probe without touching write limits (%s)', async slice => {
    const {bot, sampled, ctx} = scene();
    const anchors: [number,number,number][] = [[0,64,0],[16,80,16]];
    const result = JSON.parse(await skillProbe(bot, {skill:'probe',shape:'box',anchors,...(slice?{slice}:{})}, ctx));
    expect(result.status).toBe('partial');
    expect(result.coverage.returnedCount).toBeLessThanOrEqual(slice ? 512 : 2048);
    expect(sampled.size).toBe(result.coverage.returnedCount);
    for (const cap of [BUILD_CELL_CAP,EXCAVATE_CELL_CAP]) expect(() => shapeCells(bot,'box',anchors,undefined,cap)).toThrow();
  });
  it('partitions thin and wide boxes without gaps, overlap, range drift or automatic reads', () => {
    const {bot,sampled} = scene();
    for(const [size,cap] of [[[30,2,3],7],[[3,7,5],11],[[4,3,9],22]] as const) {
      const call={skill:'probe' as const,shape:'box' as const,anchors:[[0,64,0],[size[0]-1,63+size[1],size[2]-1]] as [number,number,number][],where:['stone']};
      const pending=[call],seen=new Set<string>();
      while(pending.length) {
        const step=pending.shift()!,page=probePage(bot,step,cap,new Date().toISOString());
        expect(page.cells.length).toBeLessThanOrEqual(cap);
        for(const c of page.cells){const key=JSON.stringify(c);expect(seen.has(key)).toBe(false);seen.add(key);}
        if(page.partial){const result=JSON.parse(page.wrap('fixture',0));pending.push(...result.next.map((next:any)=>next.arguments.steps[0]));}
      }
      expect(seen.size).toBe(size.reduce((a,b)=>a*b,1));
    }
    expect(sampled.size).toBe(0);
  });
  it('rejects malformed or unsafe geometry before block reads', async () => {
    const {bot,sampled,ctx}=scene();
    await expect(skillProbe(bot,{skill:'probe',shape:'box',anchors:[[0,64,0],[NaN,64,1]]},ctx)).rejects.toThrow();
    await expect(skillProbe(bot,{skill:'probe',shape:'box',anchors:[[-30000000,-30000000,-30000000],[30000000,30000000,30000000]]},ctx)).rejects.toThrow();
    expect(sampled.size).toBe(0);
  });
});
