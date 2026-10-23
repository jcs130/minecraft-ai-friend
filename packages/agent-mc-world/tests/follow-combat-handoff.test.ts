import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { afterEach, expect, it, vi } from 'vitest';
import { Executor } from '../core/executor.ts';
import { setOwnedGoal, goals } from '../core/travel.ts';

afterEach(()=>vi.useRealTimers());
it('keeps an explicit follow through combat and cannot clear the new combat goal from a late follow cleanup',async()=>{
  vi.useFakeTimers(); let serial=0,busy:string|null=null;
  const ally={id:2,type:'player',username:'Ally',name:'player',isValid:true,position:new Vec3(4,64,0)};
  const movements={canDig:true,scafoldingBlocks:[1]};
  const pathfinder={goal:null as unknown,movements,setGoal(goal:unknown){this.goal=goal;}};
  const bot=Object.assign(new EventEmitter(),{entity:{id:1,position:new Vec3(0,64,0)},
    game:{dimension:'overworld'},entities:{2:ally},players:{Ally:{entity:ally}},pathfinder,registry:{entitiesByName:{}},
    inventory:{items:()=>[],slots:[]},clearControlStates(){},stopDigging(){}});
  const report=vi.fn();
  const exec=new Executor({getBot:()=>bot as never,nextId:()=>++serial,busyWith:()=>busy,report,
    log:{child(){return this;},info(){},warn(){},error(){},debug(){},trace(){},emit(){}} as never});
  exec.submit([{skill:'follow',name:'Ally'}],'append');await vi.advanceTimersByTimeAsync(10);
  const task=exec.status().running!;
  expect(task,JSON.stringify(report.mock.calls)).toMatchObject({skill:'follow',followTarget:'Ally'});
  expect(movements.canDig).toBe(false);expect(movements.scafoldingBlocks).toEqual([]);
  busy='combat';exec.suspend('assist visible hostile');
  const combatGoal=new goals.GoalNear(8,64,0,1);
  setOwnedGoal(bot as never,combatGoal,'combat','approach target');
  await vi.advanceTimersByTimeAsync(150);
  expect(pathfinder.goal).toBe(combatGoal);
  busy=null;exec.resume();await vi.advanceTimersByTimeAsync(150);
  expect(exec.status().running).toMatchObject({id:task.id,skill:'follow',followTarget:'Ally'});
  expect(pathfinder.goal).not.toBe(combatGoal);
  exec.clear(true);await vi.advanceTimersByTimeAsync(150);
  expect(exec.status().running).toBeNull();expect(pathfinder.goal).toBeNull();
  expect(movements.canDig).toBe(true);expect(movements.scafoldingBlocks).toEqual([1]);
  exec.shutdown();
});
