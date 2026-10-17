import { afterEach, expect, it } from 'vitest';
import { adaptiveDivingDecision } from '../examples/adaptive-diving.mjs';
import { methodHarness, methodEnded } from './method-harness.ts';

const rigs: ReturnType<typeof methodHarness>[] = [];
afterEach(() => { for (const r of rigs.splice(0)) r.close(); });
const sample = (second: number, oxygen: number, healthLoss = 0) => ({
  sampledAt: new Date(Date.UTC(2026,9,17,8,0,second)).toISOString(),
  oxygenUpdatedAt: new Date(Date.UTC(2026,9,17,8,0,second)).toISOString(),
  oxygen, health: 20, healthLoss, headWet: true, dimension:'minecraft:overworld', entityId:1, observationEpoch:0,
});
async function decide(samples: unknown[], overrides: Record<string, unknown> = {}) {
  const r = methodHarness('1.21.1'); rigs.push(r);
  const run = r.runner.start({ name:'diving-budget-reference', code:adaptiveDivingDecision,
    params:{samples,returnSeconds:5,reserveSeconds:2,minHealth:4,...overrides} });
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
