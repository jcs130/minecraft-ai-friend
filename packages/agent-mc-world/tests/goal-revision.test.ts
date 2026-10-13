import {expect,it} from 'vitest';
import {applyGoal,parseGoal,MinecraftWorld,type GoalTable} from '../core/world.ts';
import { MINECRAFT_CLIENT_DEFAULTS } from '../src/client/config.ts';

it('returns failed arguments and identifies a host judgment closure without claiming independent verification', async () => {
  const world = new MinecraftWorld({ cfg: structuredClone(MINECRAFT_CLIENT_DEFAULTS) });
  const call = (args: Record<string, unknown>) => world.tools().find(t => t.name === 'mc_goal')!.handler(args, {} as never);
  expect(await call({slot:1})).toMatchObject({failed:true});
  await call({add:{text:'Understand the area',plan:[{do:'review the report',judgment:'read the available observations'}]}});
  await call({milestone:{slot:1,step:1,judgment:'host assessment'}});
  const result = await call({done:1});
  expect(result).toMatchObject({meta:{goalClosure:{phase:'closed',requestedBy:'host',verification:'host-judgment',semanticGoalVerified:false},taskVerification:{outcome:'unknown'}}});
  expect((result as {text:string}).text).toContain('系统未独立证明目标完成');
});
it('keeps goal identity, rejects stale revisions and invalidates old evidence for a revised plan',()=>{
  const table:GoalTable={list:[]},stamp={day:null,realTime:'2026-10-13T00:00:00Z',at:100};
  const apply=(args:Record<string,unknown>)=>{const op=parseGoal(args);if('error' in op)throw new Error(op.error);return applyGoal(table,op,stamp);};
  apply({add:{text:'Collect stone',plan:[{do:'collect',verify:{source:'inventory',item:'stone',count:'>=1'}}]}});
  const goal=table.list[0];
  goal.plan.steps[0].state='verified';
  goal.plan.steps[0].evidence={observedAt:100,connectionGeneration:1,realm:'test',dimension:'overworld',verdict:'ok',results:[]};
  const revise={slot:1,expectedRevision:1,text:'Use wood after the protection denial',reason:'Server refused the original target',
    plan:[{do:'collect wood',verify:{source:'inventory',item:'oak_log',count:'>=2'}}]};
  const receipt=JSON.parse(apply({revise}));
  expect(receipt).toMatchObject({protocol:'agent-mc/v1',kind:'goal-revision',hostAuthored:true,goalCompleted:false,
    before:{text:'Collect stone',revision:1},after:{revision:2}});
  expect(receipt.before.plan.steps[0].state).toBe('verified');
  expect(goal.at).toBe(100);expect(goal.slot).toBe(1);
  expect(goal.plan.steps[0]).toMatchObject({state:'pending',evidence:null});
  expect(apply({done:1})).toContain('还不能结案');
  expect(apply({revise})).toContain('未修订');expect(goal.revision).toBe(2);
});
