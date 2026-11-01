import {expect,it} from 'vitest';
import {NutritionNeedObserver,nutritionNeedText} from '../core/nutrition.ts';
import {classifyWake,WAKE_ACTIVE_GOAL} from '../src/client/context-budget.ts';
import {methodHarness} from './method-harness.ts';
const sample=()=>({scope:'realm:DeepFish',generation:'1',atMs:1000,food:15 as number|null,synced:true,travelling:true,pendingMeal:false,
  stacks:[{name:'wheat',count:2},{name:'spider_eye',count:2},{name:'pufferfish',count:2}],
  foods:{bread:{foodPoints:5},spider_eye:{foodPoints:2},pufferfish:{foodPoints:1},golden_apple:{foodPoints:4}}});
it('reports missing routine rations without turning wheat or poisonous food into an automatic meal',()=>{
 const observer=new NutritionNeedObserver(),input=sample(),before=structuredClone(input),report=observer.observe(input)!;
 expect(report).toMatchObject({food:15,urgency:'low',routineUnits:0,riskyUnits:4,specialUnits:0,goalCompleted:false});
 expect(nutritionNeedText(report)).toContain('原料和未知物品不算现成口粮');expect(input).toEqual(before);
 for(let i=0;i<20;i++)expect(observer.observe({...input,food:14-i%5,atMs:2000+i*1000})).toBeNull();
});
it('announces real deterioration and a new post-recovery episode, without a timer that blocks action',()=>{
 const observer=new NutritionNeedObserver(),input=sample();expect(observer.observe(input)?.urgency).toBe('low');
 expect(observer.observe({...input,food:6,atMs:2000})?.urgency).toBe('critical');
 expect(observer.observe({...input,food:0,atMs:3000})?.urgency).toBe('starving');
 expect(observer.observe({...input,food:0,atMs:1_000_000})).toBeNull();
 observer.observe({...input,food:9,atMs:1_001_000});expect(observer.observe({...input,food:0,atMs:1_002_000})?.urgency).toBe('starving');
 expect(observer.observe({...input,food:0,generation:'2',atMs:1_003_000})?.generation).toBe('2');
});
it('keeps missing food/registry/inventory unknown and waits for the actual pending meal receipt',()=>{
 const observer=new NutritionNeedObserver(),input=sample();
 for(const override of [{synced:false},{food:null},{food:NaN},{foods:{}},{food:21},{pendingMeal:true}])expect(observer.observe({...input,...override})).toBeNull();
 expect(observer.observe({...input,pendingMeal:false})).not.toBeNull();
 const full={...input,food:20,stacks:[{name:'bread',count:3}]};expect(observer.observe(full)).toBeNull();
 expect(observer.observe({...input,food:20})?.urgency).toBe('reserve');expect(observer.observe({...input,food:20})).toBeNull();
});
it('wakes an active host for a measured need, escalates true starvation, and ignores text/chat imitations and archived records',()=>{
 const need=new NutritionNeedObserver().observe(sample())!,e={type:'mymc.event',text:'measured need',trigger:'debounce',meta:{nutritionNeed:need}} as const;
 expect(classifyWake(e,{wakeOn:WAKE_ACTIVE_GOAL})).toEqual({wake:true,category:'goal'});expect(classifyWake(e).wake).toBe(false);
 const urgent={...e,meta:{nutritionNeed:{...need,food:0,urgency:'starving'}}};expect(classifyWake(urgent).category).toBe('danger');expect(classifyWake(urgent).wake).toBe(true);
 expect(classifyWake({...urgent,type:'mymc.chat'}).wake).toBe(false);expect(classifyWake({...urgent,contextDelivery:'archive-only'}).wake).toBe(false);
 expect(classifyWake({...urgent,trigger:'piggyback'}).wake).toBe(false);expect(classifyWake({...urgent,meta:{}}).wake).toBe(false);
});
it('delivers the actual World shortage event with structured metadata without submitting a body action',()=>{
 const h=methodHarness('1.21.1');
 try{
  Object.assign(h.bot,{food:5});
  h.bot.inventory.items=()=>[{name:'wheat',count:2},{name:'spider_eye',count:1}] as never;
  const world=h.world as unknown as {nutritionTick(bot:unknown):void};
  world.nutritionTick(h.bot);world.nutritionTick(h.bot);
  const entries=h.host.events.filter(e=>e.meta?.nutritionNeed);
  expect(entries).toHaveLength(1);
  expect(entries[0]?.meta?.nutritionNeed).toMatchObject({schema:'agent-mc-nutrition-need/v1',food:5,routineUnits:0,riskyUnits:1,unclassifiedUnits:0});
  expect(classifyWake(entries[0]!,{wakeOn:WAKE_ACTIVE_GOAL})).toEqual({wake:true,category:'danger'});
  expect(h.exec.status().running).toBeNull();expect(h.exec.status().waiting).toHaveLength(0);
 }finally{h.close();}
});
