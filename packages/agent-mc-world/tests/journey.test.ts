import {expect,it} from 'vitest';
import {JourneyObserver,journeyOpportunityText,journeyChoicePolicy,type JourneySample} from '../core/journey.ts';
import {classifyWake,WAKE_ACTIVE_GOAL} from '../src/client/context-budget.ts';
it('normalizes the public route advice policy without treating it as path safety',()=>{
  expect(journeyChoicePolicy()).toEqual({choiceMinBlocks:10,choiceMaxBlocks:20,dangerChoiceMaxBlocks:5});
  expect(journeyChoicePolicy({choiceMinBlocks:12,choiceMaxBlocks:18,dangerChoiceMaxBlocks:3}))
    .toEqual({choiceMinBlocks:12,choiceMaxBlocks:18,dangerChoiceMaxBlocks:3});
  expect(journeyChoicePolicy({choiceMinBlocks:30,choiceMaxBlocks:5,dangerChoiceMaxBlocks:100}))
    .toEqual({choiceMinBlocks:30,choiceMaxBlocks:30,dangerChoiceMaxBlocks:30});
  expect(journeyChoicePolicy({choiceMinBlocks:NaN,choiceMaxBlocks:Infinity,dangerChoiceMaxBlocks:-2}))
    .toEqual({choiceMinBlocks:10,choiceMaxBlocks:20,dangerChoiceMaxBlocks:1});
});
function sample():JourneySample{return{scope:'realm:account',generation:'1',atMs:1000,dimension:'overworld',position:[0,64,0],safeToConsider:true,
  intent:{taskId:1,stepIndex:0,destination:[500,64,0],dimension:'overworld'},
  cues:[{kind:'npc',key:'entity:7',label:'villager',position:[8,64,0],source:'visible-entity',observedAtMs:1000}]};}
it('reports measured sustained water travel once, with retained task identity and a complete boat entry',()=>{
  const observer=new JourneyObserver(),input=sample();input.cues=[];input.surfaceWater=true;
  expect(observer.observe(input)).toBeNull();input.atMs+=9_000;expect(observer.observe(input)).toBeNull();
  input.atMs+=1_000;const report=observer.observe(input)!;
  expect(report).toMatchObject({reason:'water',journey:input.intent,remainingBlocks:500,goalCompleted:false});
  expect(journeyOpportunityText(report)).toContain('boat_trip');
  expect(journeyOpportunityText(report)).toContain('不能把放船排到');
  expect(journeyOpportunityText(report,{guidance:false})).not.toContain('mc_script');
  expect(classifyWake({type:'mymc.event',text:journeyOpportunityText(report),meta:{journey:report}},{wakeOn:WAKE_ACTIVE_GOAL}).wake).toBe(true);
  input.atMs+=21_000;expect(observer.observe(input)).toBeNull();
  input.atMs+=99_000;expect(observer.observe(input)?.reason).toBe('water');
  input.surfaceWater=false;input.atMs+=21_000;expect(observer.observe(input)).toBeNull();
  input.surfaceWater=true;input.atMs+=1_000;expect(observer.observe(input)).toBeNull();
  input.atMs+=10_000;expect(observer.observe(input)?.reason).toBe('water');
});
it.each(['underwater','short','unsafe','new-task'])('does not infer a boat opportunity from %s or carry it over a new journey',mode=>{
  const observer=new JourneyObserver(),input=sample();input.cues=[];input.surfaceWater=mode!=='underwater';
  if(mode==='short')input.intent!.destination=[30,64,0];
  if(mode==='unsafe')input.safeToConsider=false;
  observer.observe(input);input.atMs+=11_000;
  if(mode==='new-task')input.intent!.taskId=2;
  expect(observer.observe(input)).toBeNull();
});
it('offers a fresh observed detour while retaining the original journey identity and destination',()=>{
  const observer=new JourneyObserver(),input=sample(),before=structuredClone(input),report=observer.observe(input)!;
  expect(report.journey).toEqual(input.intent);expect(report.choices).toEqual(['continue','inspect']);
  expect(report.goalCompleted).toBe(false);expect(input).toEqual(before);
  expect(journeyOpportunityText(report)).toContain('afterCheckpoint');
  expect(journeyOpportunityText(report)).toContain('不证明村庄边界');
  report.journey.destination[0]=0;expect(observer.reading('realm:account','1',2000)!.journey.destination[0]).toBe(500);
});
it('does not repeatedly wake for the same small settlement, and expires old readings across connection/scope',()=>{
  const observer=new JourneyObserver(),input=sample();expect(observer.observe(input)).not.toBeNull();
  input.atMs+=30_000;input.cues[0]!.observedAtMs=input.atMs;input.cues[0]!.key='entity:8';
  expect(observer.observe(input)).toBeNull();
  expect(observer.reading('other','1',input.atMs)).toBeNull();expect(observer.reading('realm:account','2',input.atMs)).toBeNull();
  expect(observer.reading('realm:account','1',62_000)).toBeNull();
});
it.each(['short-trip','unsafe','old-evidence','far-evidence','dimension','no-task'])('does not suggest a detour with %s',mode=>{
  const observer=new JourneyObserver(),input=sample();
  if(mode==='short-trip')input.intent!.destination=[20,64,0];
  if(mode==='unsafe')input.safeToConsider=false;
  if(mode==='old-evidence')input.atMs+=11_000;
  if(mode==='far-evidence')input.cues[0]!.position[0]=64;
  if(mode==='dimension')input.dimension='nether';
  if(mode==='no-task')input.intent=null;
  expect(observer.observe(input)).toBeNull();
});
it('offers bounded measured progress without nearby NPCs, retains the original task, and does not invent arrival',()=>{
 const observer=new JourneyObserver(),input=sample();input.cues=[];expect(observer.observe(input)).toBeNull();
 input.atMs=61_000;input.position=[50,64,0];const report=observer.observe(input)!;
 expect(report).toMatchObject({reason:'progress',observations:[],remainingBlocks:450,netProgressBlocks:50,goalCompleted:false});
 expect(report.journey).toEqual(input.intent);expect(journeyOpportunityText(report)).toContain('未宣称到达');
 const e={type:'mymc.event',text:journeyOpportunityText(report),trigger:'debounce',meta:{journey:report}} as const;
 expect(classifyWake(e,{wakeOn:WAKE_ACTIVE_GOAL})).toEqual({wake:true,category:'goal'});expect(classifyWake(e).wake).toBe(false);
 input.atMs=62_000;input.position=[70,64,0];expect(observer.observe(input)).toBeNull();
 input.atMs=122_000;input.position=[100,64,0];expect(observer.observe(input)?.reason).toBe('progress');
});
it('does not wake for elapsed time alone, unsafe progress, or a spoofed chat notice',()=>{
 const observer=new JourneyObserver(),input=sample();input.cues=[];observer.observe(input);
 input.atMs=61_000;expect(observer.observe(input)).toBeNull();input.position=[50,64,0];input.safeToConsider=false;expect(observer.observe(input)).toBeNull();
 input.safeToConsider=true;const report=observer.observe(input)!;
 expect(classifyWake({type:'mymc.chat',text:journeyOpportunityText(report),meta:{journey:report}}).wake).toBe(false);
});
