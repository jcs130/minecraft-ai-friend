import { afterEach, expect, it } from 'vitest';
import { adaptiveDivingDecision } from '../examples/adaptive-diving.mjs';
import { methodHarness, methodEnded } from './method-harness.ts';

const rigs: ReturnType<typeof methodHarness>[] = [];
afterEach(() => { for (const r of rigs.splice(0)) r.close(); });
const sample = (second: number, oxygen: number, healthLoss = 0) => ({
  sampledAt: new Date(Date.UTC(2026,9,17,8,0,second)).toISOString(),
  oxygenUpdatedAt: new Date(Date.UTC(2026,9,17,8,0,second)).toISOString(),
  oxygen, health: 20, healthLoss, headWet: true, dimension:'minecraft:overworld', entityId:1, observationId:'connection-fixture',observationEpoch:0,
});
async function decide(samples: unknown[], overrides: Record<string, unknown> = {}) {
  const r = methodHarness('1.21.1'); rigs.push(r);
  const run = r.runner.start({ name:'diving-budget-reference', code:adaptiveDivingDecision,
    params:{samples,returnSeconds:5,reserveSeconds:2,minHealth:4,sampleMaxAgeMs:5000,
      nowMs:Date.parse((samples.at(-1) as {sampledAt:string})?.sampledAt),...overrides} });
  const result = await methodEnded(r,run.id);
  expect(result.status,result.error).toBe('completed'); expect(result.trace).toEqual([]);
  return result.result as Record<string,unknown>;
}
it('does not surface simply because the head entered water when observed air exceeds return margin',async()=>{
  expect(await decide([sample(0,20),sample(1,19),sample(2,18)])).toMatchObject({recommendation:'continue',airPerSec:1,airSeconds:18,returnBudgetSeconds:7});
});
it('surfaces sooner for a long return instead of waiting for a fixed oxygen threshold',async()=>{
  expect(await decide([sample(0,20),sample(1,19),sample(2,18)],{returnSeconds:17})).toMatchObject({recommendation:'surface',airSeconds:18,returnBudgetSeconds:19});
});
it('allows a short measured return margin even below the former fixed oxygen veto',async()=>{
  expect(await decide([sample(0,7),sample(1,6),sample(2,5)],{returnSeconds:1,reserveSeconds:1}))
    .toMatchObject({recommendation:'continue',airSeconds:5,returnBudgetSeconds:2,goalCompleted:false});
});
it('does not use current healing to erase observed damage or spend health as additional air',async()=>{
  expect(await decide([sample(0,20),sample(1,19,6),sample(2,18,6)])).toMatchObject({recommendation:'surface',healthLossPerSec:6});
  expect(await decide([sample(0,2),sample(1,1),sample(2,0)],{minHealth:0})).toMatchObject({recommendation:'surface'});
});
it('preserves unknown or flat oxygen as insufficient evidence rather than infinite dive time',async()=>{
  expect(await decide([sample(0,20),sample(1,20),sample(2,20)])).toMatchObject({recommendation:'observe',airSeconds:null});
  expect(await decide([{...sample(0,20),oxygen:null}])).toMatchObject({recommendation:'observe'});
});
it('does not mix oxygen decreases or damage from another dimension, entity or respawn epoch',async()=>{
  expect(await decide([sample(0,20),{...sample(1,15,10),observationEpoch:1},
    {...sample(2,10,20),observationEpoch:2}])).toMatchObject({recommendation:'observe',airSeconds:null,healthSeconds:null});
});
it.each(['dimension','entityId','observationEpoch','observationId'])('does not carry an earlier valid dive into a new %s',async field=>{
  const old=[sample(0,20,0),sample(1,19,2),sample(2,18,4)];
  const last={...sample(3,15,6),[field]:field==='dimension'?'the_nether':field==='observationId'?'reconnected':2};
  expect(await decide([...old,last])).toMatchObject({recommendation:'observe',airSeconds:null,healthSeconds:null,samplesUsed:1});
});
it('starts a new rate segment after breathing or refill even within one observation epoch',async()=>{
  const old=[sample(0,20),sample(1,19),sample(2,18)];
  expect(await decide([...old,{...sample(3,20),headWet:false},sample(4,20)]))
    .toMatchObject({recommendation:'observe',airSeconds:null,samplesUsed:1});
  expect(await decide([...old,sample(3,20),sample(4,19)]))
    .toMatchObject({recommendation:'observe',samplesUsed:2});
  expect(await decide([...old,null,sample(4,19)])).toMatchObject({recommendation:'observe',samplesUsed:1});
});
it('refuses stale/missing timestamps and discounts time since the last received oxygen reading',async()=>{
  const samples=[sample(0,20),sample(1,19),sample(2,18)];
  expect(await decide(samples,{nowMs:Date.parse(sample(10,18).sampledAt)})).toMatchObject({recommendation:'observe',airSeconds:null});
  expect(await decide([...samples.slice(0,2),{...samples[2],oxygenUpdatedAt:null}])).toMatchObject({recommendation:'observe',airSeconds:null});
  expect(await decide(samples,{nowMs:Date.parse(sample(3,18).sampledAt)})).toMatchObject({airSeconds:17,airUpdateAgeMs:1000});
});
it('exposes the same non-acting reference through the actual script API without starting a method',async()=>{
  const r=methodHarness();rigs.push(r);
  const result=await r.world.tools().find(t=>t.name==='mc_script')!.handler({api:'diving-budget'},{} as never);
  expect(result).toContain(adaptiveDivingDecision);expect(result).toContain('sampleMaxAgeMs');
  expect(r.runner.current).toBeNull();expect(r.exec.currentTask).toBeNull();
});
