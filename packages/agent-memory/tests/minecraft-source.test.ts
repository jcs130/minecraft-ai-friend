import { describe, expect, it } from 'vitest';
import { fromEvent, InventoryDeltaTracker, preferenceFacts, worldNamespace } from '../src/index.ts';
import { OVERWORLD } from './helpers.ts';

const ctx = { self: 'Komi', world: OVERWORLD };
const ts = '2026-11-16T12:00:00Z';

describe('Minecraft episode source', () => {
  it('maps join/leave/whisper/death/level/task and ignores noise', () => {
    expect(fromEvent({ type: 'minecraft.enter', ts, text: '[Minecraft] 玩家 Steve 进入了服务器。', meta: { uname: 'Steve' } }, ctx)?.facts[0])
      .toMatchObject({ relation: 'IS_ONLINE', value: true });
    expect(fromEvent({ type: 'minecraft.leave', ts, text: 'x', meta: { uname: 'Steve' } }, ctx)?.facts[0]).toMatchObject({ value: false });
    const w = fromEvent({ type: 'minecraft.chat', ts, text: '[MC 私聊] Steve: 我喜欢钓鱼', meta: { uname: 'Steve' }, cursor: 7 }, ctx)!;
    expect(w.kind).toBe('whisper');
    expect(w.source.ref).toBe('cursor:7');
    expect(w.facts.map(f => `${f.relation}:${f.object?.name}`)).toEqual(['KNOWS:Steve', 'LIKES:钓鱼']);
    const pub = fromEvent({ type: 'minecraft.chat', ts, text: '[MC] Alex: 今天天气不错', meta: { uname: 'Alex' } }, ctx)!;
    expect(pub.facts).toEqual([]);
    expect(fromEvent({ type: 'minecraft.chat', ts, text: '[MC 动作栏] 灵力 10/10', meta: { channel: 'system' } }, ctx)).toBeNull();
    expect(fromEvent({ type: 'minecraft.world.snapshot', ts, text: 'big snapshot' }, ctx)).toBeNull();
    expect(fromEvent({ type: 'minecraft.event', ts, text: '[Minecraft] 附近有僵尸×2。' }, ctx)).toBeNull();
    const death = fromEvent({ type: 'minecraft.event', ts, text: '[Minecraft] 你死了(今天第 1 次)。',
      meta: { death: { id: 'd1', position: { x: 10.7, y: 64, z: -3.2, dimension: 'minecraft:overworld' }, cause: { text: '被僵尸杀死了' } } } }, ctx)!;
    expect(death.kind).toBe('death');
    expect(death.facts[0]).toMatchObject({ relation: 'DIED_AT', object: { name: 'minecraft:overworld|10,64,-4' }, value: '被僵尸杀死了' });
    expect(fromEvent({ type: 'minecraft.event', ts, text: '[Minecraft] 升到 12 级了。' }, ctx)!.facts[0]).toMatchObject({ relation: 'HAS_LEVEL', value: 12 });
    const task = fromEvent({ type: 'minecraft.task', ts, text: 'done', execution: { kind: 'task', id: 't9', phase: 'completed', terminal: true } }, ctx)!;
    expect(task.facts.map(f => f.relation)).toEqual(['PARTICIPATED_IN', 'HAS_STATUS']);
    expect(fromEvent({ type: 'minecraft.task', ts, text: 'r', execution: { kind: 'task', id: 't9', phase: 'running', terminal: false } }, ctx)).toBeNull();
  });

  it('own outgoing chat is logged without facts', () => {
    const e = fromEvent({ type: 'minecraft.chat', ts, text: '[MC] Komi: 我喜欢你们', meta: { uname: 'Komi' } }, ctx)!;
    expect(e.facts).toEqual([]);
    expect(e.data.outgoing).toBe(true);
  });

  it('extracts preferences conservatively', () => {
    const r = (m: string) => preferenceFacts('P', m, ts).map(f => `${f.negated ? '!' : ''}${f.relation}:${f.object!.name}`);
    expect(r('我最喜欢红石了！')).toEqual(['LIKES:红石']);
    expect(r('我不喜欢下雨')).toEqual(['DISLIKES:下雨']);
    expect(r('我已经不再喜欢挖矿了')).toEqual(['!LIKES:挖矿']);
    expect(r('I really like building castles.')).toEqual(['LIKES:building castles']);
    expect(r("I don't like creepers")).toEqual(['DISLIKES:creepers']);
    expect(r('hello there')).toEqual([]);
  });

  it('inventory tracker records meaningful deltas only', () => {
    const t = new InventoryDeltaTracker('Komi');
    expect(t.observe({ dirt: 64, oak_log: 3 }, ts)).toBeNull(); // baseline
    expect(t.observe({ dirt: 10, oak_log: 5 }, ts)).toBeNull(); // common / count-only change
    const d = t.observe({ dirt: 10, oak_log: 5, 'minecraft:diamond': 2, bread: 1 }, ts)!;
    expect(d.facts.map(f => `${f.object!.name}=${f.value}`).sort()).toEqual(['bread=1', 'diamond=2']);
    const d2 = t.observe({ dirt: 10, oak_log: 5, diamond: 3 }, ts)!;
    expect(d2.facts.map(f => `${f.negated ? '!' : ''}${f.object!.name}`).sort()).toEqual(['!bread', 'diamond']);
  });

  it('unknown world identity never shares a persistent namespace', () => {
    expect(worldNamespace({ key: 'minecraft:overworld' })).toBe('minecraft:overworld');
    expect(worldNamespace({ key: null, connection: 'a', revision: 1 })).not.toBe(worldNamespace({ key: null, connection: 'b', revision: 1 }));
    expect(worldNamespace(null)).toBe('unknown-world:unobserved:0');
  });
});
