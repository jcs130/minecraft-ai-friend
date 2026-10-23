import {expect,it} from 'vitest';
import {JourneyObserver,journeyOpportunityText,type JourneySample} from '../core/journey.ts';
function sample():JourneySample{return{scope:'realm:account',generation:'1',atMs:1000,dimension:'overworld',position:[0,64,0],safeToConsider:true,
  intent:{taskId:1,stepIndex:0,destination:[500,64,0],dimension:'overworld'},
  cues:[{kind:'npc',key:'entity:7',label:'villager',position:[8,64,0],source:'visible-entity',observedAtMs:1000}]};}
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
