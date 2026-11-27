import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseProtectedRegion, ProtectedRegions } from '../core/protection-regions.ts';
import { precheckSteps, renderPrecheckNotes, type PrecheckDeps } from '../core/precheck.ts';
import { protectInDeclaredRegions, protectionCheck, type BlockProtectionPort } from '../core/protection-port.ts';

const NOTICE = '试炼场及外围为公共设施保护区：X=-610..-570、Z=-338..-270。请到范围外采集、建造；入口按钮、门和正常试炼可以使用。';
const FILE = 'minecraft-protected-regions.json';
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const tmp = () => { const dir = mkdtempSync(join(tmpdir(), 'regions-')); dirs.push(dir); return dir; };
const inZone = (cell: { x: number; z: number }) => cell.x >= -610 && cell.x <= -570 && cell.z >= -338 && cell.z <= -270;
const regionLabel = (cell: { x: number; y: number; z: number }) => inZone(cell)
  ? '服务端声明的保护区 [overworld] X=-610..-570、Z=-338..-270' : null;
const cell = (a: number[]): { x: number; y: number; z: number } => ({ x: a[0], y: a[1], z: a[2] });

describe('server-declared protected regions', () => {
  it('reads the X/Z box from a restriction notice and nothing else', () => {
    expect(parseProtectedRegion(NOTICE)).toEqual({ x: [-610, -570], z: [-338, -270] });
    expect(parseProtectedRegion('此区域禁止建造 X: 10 ~ 20, Z=3到9')).toEqual({ x: [10, 20], z: [3, 9] });
    expect(parseProtectedRegion('试炼场 X=-610..-570、Z=-338..-270 在东南边')).toBeNull();
    expect(parseProtectedRegion('禁止建造 X=0..99999、Z=0..1')).toBeNull();
    expect(parseProtectedRegion('试炼场保护区 X=-610..-570')).toBeNull();
    expect(parseProtectedRegion('')).toBeNull();
  });

  it('keeps the region per dimension, dedupes repeats and survives a restart', () => {
    const dir = tmp();
    const first = new ProtectedRegions(join(dir, FILE));
    first.load();
    expect(first.read()).toBeNull();
    expect(first.note(NOTICE, 'minecraft:overworld', new Date('2026-11-23T13:57:05Z'))).toBe(true);
    expect(first.note(NOTICE, 'overworld', new Date('2026-11-23T14:10:00Z'))).toBe(false);
    expect(first.size).toBe(1);
    expect(first.note('玩家说这片不能挖', 'overworld')).toBe(false);
    expect(first.covers('overworld', { x: -590, z: -314 })?.at).toBe('2026-11-23T14:10:00.000Z');
    expect(first.covers('minecraft:overworld', { x: -611, z: -300 })).toBeNull();
    expect(first.covers('world_nether', { x: -590, z: -314 })).toBeNull();
    const text = first.read('minecraft:overworld')!;
    expect(text).toContain('[overworld] X=-610..-570、Z=-338..-270');
    expect(text).toContain('不授予也不否决权限');
    expect(first.read('world_nether')).toBeNull();

    const restored = new ProtectedRegions(join(dir, FILE));
    restored.load();
    expect(restored.covers('overworld', { x: -571, z: -271 })?.text).toContain('公共设施保护区');

    writeFileSync(join(dir, FILE), '{"v":1,"regions":"broken"');
    expect(() => new ProtectedRegions(join(dir, FILE)).load()).not.toThrow();
  });

  it('warns at admission when terrain steps fall inside a remembered region, without changing the task', () => {
    const dir = tmp();
    const regions = new ProtectedRegions(join(dir, FILE));
    regions.note(NOTICE, 'overworld');
    const bot = { inventory: { items: () => [], slots: [] }, heldItem: null };
    const deps: PrecheckDeps = { resolve: (a) => (Array.isArray(a) ? cell(a) : null),
      cellsOf: () => null, blockAt: () => null, protectedRegion: (c) => regions.covers('overworld', c) ? regionLabel(c) : null };
    const build = { skill: 'build', shape: 'box', anchors: [[-590, 91, -314], [-587, 93, -311]], material: 'spruce_planks' } as never;
    const harvest = { skill: 'harvest', block: 'spruce_log', at: [-575, 92, -303] } as never;
    const steps = [{ skill: 'goto', at: [-580, 91, -308] } as never, harvest, build,
      { skill: 'craft', item: 'spruce_planks', count: 4 } as never];
    const original = structuredClone(steps);
    const notes = precheckSteps(bot as never, steps, deps);
    expect(notes.map(note => note.index)).toEqual([1, 2]);
    for (const note of notes) expect(note.note).toMatchObject({ level: 'hard', rule: 'terrain.protectedRegion' });
    const receipt = renderPrecheckNotes(notes)!;
    expect(receipt).toContain('试算(还没动工)');
    expect(receipt).toContain('第 2 步harvest 有 1/1 个目标格落在服务端声明的保护区 [overworld] X=-610..-570、Z=-338..-270');
    expect(receipt).toContain('第 3 步build 有 2/2 个目标格');
    expect(receipt).toContain('区内采集、建造会被服务端拒绝，换到范围外再提交');
    expect(steps).toEqual(original);

    const shaped: PrecheckDeps = { ...deps, cellsOf: () => [[-590, 91, -314], [-587, 92, -314], [-565, 91, -314], [-566, 91, -314], [-567, 91, -314]].map(cell) };
    const mixed = precheckSteps(bot as never, [{ ...build, anchors: [[-590, 91, -314], [-567, 91, -314]] } as never], shaped);
    expect(mixed[0]?.note.text).toContain('build 有 2/5 个目标格');
    expect(precheckSteps(bot as never, [{ ...build, dryRun: true } as never], deps)).toEqual([]);
    expect(precheckSteps(bot as never, [{ ...harvest, at: [-565, 92, -303] } as never], deps)).toEqual([]);
    expect(precheckSteps(bot as never, [harvest], { ...deps, protectedRegion: undefined })).toEqual([]);
    expect(precheckSteps(bot as never, [{ skill: 'goto', at: [-580, 91, -308] } as never], deps)).toEqual([]);
  });

  it('asks the server before a dig or place inside a remembered region even without global preflight', async () => {
    const asked: Array<{ action: string; cell: { x: number; y: number; z: number }; fresh?: boolean }> = [];
    const port: BlockProtectionPort = {
      verdict: () => null,
      check: async (action, dimension, cell, fresh) => {
        asked.push({ action, cell, fresh });
        return { action, dimension, ...cell, status: inZone(cell) ? 'deny' : 'allow_likely', reason: 'worldguard' };
      },
    };
    const logged: string[] = [];
    const check = protectInDeclaredRegions(protectionCheck(port, () => 'minecraft:overworld', () => false),
      regionLabel, (reply, region, action, at) => { logged.push(`${region} ${action} ${at.x},${at.z} ${reply.status}`); });
    expect(await check('place', cell([-590, 91, -314]))).toMatchObject({ status: 'deny', reason: 'worldguard' });
    expect(await check('break', cell([-620, 91, -314]))).toBeNull();
    expect(asked).toEqual([{ action: 'place', cell: cell([-590, 91, -314]), fresh: undefined }]);
    expect(logged).toEqual(['服务端声明的保护区 [overworld] X=-610..-570、Z=-338..-270 place -590,-314 deny']);

    asked.length = 0;
    const cached = protectInDeclaredRegions(protectionCheck({ ...port, verdict: () => 'deny' }, () => 'overworld', () => true),
      () => null);
    expect(await cached('break', cell([-590, 91, -314]))).toMatchObject({ status: 'deny' });
    expect(await cached('break', cell([-620, 91, -314]), 'after_failure')).toMatchObject({ status: 'allow_likely' });
    expect(asked.map(entry => entry.fresh)).toEqual([undefined, undefined]);
  });
});
