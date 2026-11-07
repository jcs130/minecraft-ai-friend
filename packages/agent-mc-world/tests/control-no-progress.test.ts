import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {Vec3} from 'vec3';
import type {Bot} from 'mineflayer';
import {skillControl} from '../core/skills-control.ts';
import {SkillBlocked, type SkillContext} from '../core/skill-context.ts';
import {methodHarness} from './method-harness.ts';
import {parseSteps} from '../core/skills.ts';

const fixtures: ReturnType<typeof methodHarness>[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {for (const h of fixtures.splice(0)) h.close();vi.useRealTimers();});
const ctx = {aborted: () => false} as SkillContext;

it('parses absolute zero headings explicitly and rejects unknown orientation modes',()=>{
  expect(parseSteps([{skill:'control',keys:[],orientation:'absolute',yawDeg:0}])).toMatchObject({steps:[{orientation:'absolute',yawDeg:0}]});
  expect(parseSteps([{skill:'control',keys:[],yawDeg:0}])).toHaveProperty('error');
  expect(parseSteps([{skill:'control',keys:['forward'],orientation:'north'}])).toHaveProperty('error');
});

it('moves east using an absolute heading from a nonzero initial heading and preserves legacy relative turns',async()=>{
  const h=methodHarness('1.21.1');fixtures.push(h);
  h.bot.entity.yaw=Math.PI/2;h.bot.entity.pitch=.3;
  const start=h.bot.entity.position.clone();
  const move=skillControl(h.bot as unknown as Bot,
    {skill:'control',mode:'ground',orientation:'absolute',keys:['forward'],yawDeg:-90,durationMs:1000},ctx);
  await vi.advanceTimersByTimeAsync(1000);await move;
  expect(h.bot.entity.position.x-start.x).toBeGreaterThan(1);
  expect(Math.abs(h.bot.entity.position.z-start.z)).toBeLessThan(.05);
  expect(h.bot.entity.pitch).toBeCloseTo(.3);
  const turn=skillControl(h.bot as unknown as Bot,{skill:'control',mode:'ground',keys:[],yawDeg:90,durationMs:50},ctx);
  await vi.advanceTimersByTimeAsync(50);await turn;
  expect(h.bot.entity.yaw).toBeCloseTo(0);expect(Object.values(h.keys).some(Boolean)).toBe(false);
});

it('reports blocked translation against a real collision wall and releases all keys', async () => {
  const h = methodHarness('1.21.1');fixtures.push(h);
  h.bot.entity.position = new Vec3(.5,64,.3);
  h.set(0,64,-1,'stone');h.set(0,65,-1,'stone');
  const forcedMoveListeners=h.bot.listenerCount('forcedMove');
  const result = skillControl(h.bot as unknown as Bot,
    {skill:'control',mode:'ground',keys:['forward'],durationMs:2000},ctx)
    .then(value => ({value,error:null}),error => ({value:null,error}));
  await vi.advanceTimersByTimeAsync(2000);
  const settled = await result;
  expect(settled.error).toBeInstanceOf(SkillBlocked);
  expect(settled.error).toMatchObject({code:'control-no-progress'});
  expect(h.bot.entity.position.distanceTo(new Vec3(.5,64,.3))).toBeLessThan(.05);
  expect(Object.values(h.keys).some(Boolean)).toBe(false);
  expect(h.bot.listenerCount('forcedMove')).toBe(forcedMoveListeners);
});

it('keeps rotation and deliberate opposing inputs valid without claiming translation', async () => {
  const h=methodHarness();fixtures.push(h);
  const turn=skillControl(h.bot as unknown as Bot,
    {skill:'control',mode:'ground',keys:[],yawDeg:90,durationMs:500},ctx);
  await vi.advanceTimersByTimeAsync(500);
  expect(await turn).toContain('仅转头');
  expect(h.bot.entity.yaw).toBeCloseTo(Math.PI/2);
  const neutral=skillControl(h.bot as unknown as Bot,
    {skill:'control',mode:'ground',keys:['forward','back'],durationMs:500},ctx);
  await vi.advanceTimersByTimeAsync(500);
  expect(await neutral).toContain('直接控制结束');
});

it('keeps real unblocked physics motion successful', async () => {
  const h=methodHarness();fixtures.push(h);
  const start=h.bot.entity.position.clone();
  const move=skillControl(h.bot as unknown as Bot,
    {skill:'control',mode:'ground',keys:['forward'],durationMs:1000},ctx);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await move).toContain('直接控制结束');
  expect(h.bot.entity.position.distanceTo(start)).toBeGreaterThan(1);
  expect(Object.values(h.keys).some(Boolean)).toBe(false);
});

it('delivers repeated measured failures through the native task event and queue receipt',async()=>{
  const h=methodHarness('1.21.1');fixtures.push(h);
  h.bot.entity.position=new Vec3(.5,64,.3);h.set(0,64,-1,'stone');h.set(0,65,-1,'stone');
  for(const durationMs of [1000,1500]){
    const accepted=h.exec.submitDetailed([{skill:'control',mode:'ground',keys:['forward'],durationMs}],'append');
    expect(accepted.accepted).toBe(true);
    await vi.advanceTimersByTimeAsync(durationMs+250);
  }
  const terminal=h.host.events.filter(e=>e.type==='minecraft.task'&&e.execution?.terminal).at(-1)!;
  expect(terminal.execution).toMatchObject({phase:'blocked',goalCompleted:false});
  expect(terminal.meta?.taskRecovery).toMatchObject({protocol:'agent-mc-task-recovery/v1',automaticReplay:false});
  expect(terminal.text).toContain('[行动恢复记录]');
  expect(terminal.execution?.evidence).toMatchObject({steps:[{decision:{reason:'control-no-progress'}}]});
});
