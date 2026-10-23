import { describe, expect, it } from 'vitest';
import { MethodRunner, METHOD_LIMITS, type MethodRun } from '../core/method-runner.ts';
import { listWorkRoutines, prepareWorkRoutine, readWorkRoutine } from '../core/work-routines.ts';
import { methodEnded, methodHarness } from './method-harness.ts';

const cell = [1, 64, 0], dimension = 'overworld';
function rig(id: string, params: Record<string, unknown>, options: { noChange?: boolean; denyAt?: number; named?: boolean; hideRemoved?: boolean } = {}) {
  let time = 0, actions = 0;
  const inventory: Record<string, number> = { wheat_seeds: 2, wheat: 0, oak_log: 0, dirt: 12, bread: 0 };
  const blocks = new Map<string, { name: string; properties: Record<string, unknown> }>();
  for (const at of (params.cells as number[][] ?? [])) blocks.set(at.join(','), { name: (params.crop ?? params.block) as string, properties: { age: 7 } });
  const request = prepareWorkRoutine(id, params);
  const writes: Record<string, any>[] = [];
  const state = () => ({ sampledAt: new Date(1000 + ++time).toISOString(), connectionGeneration: 1,
    combatActive: false, snapshot: { invSynced: true, health: 20, food: 20, dimension,
      position: { x: 0.5, y: 64, z: 0.5 }, inventory: Object.entries(inventory).filter(([,count]) => count > 0).map(([name, count]) => ({ name, count })) } });
  let ended!: (value: MethodRun) => void;
  const terminal = new Promise<MethodRun>(resolve => { ended = resolve; });
  const runner = new MethodRunner({ nativeMethods: ['blockAt', 'inventory.items', 'read'], onFinish: ended,
    call: async (method, args) => {
      if (method === 'state') return state();
      if (method === 'mineflayer') {
        if (args.name === 'read') return {value:{id:1}};
        if (args.name === 'inventory.items') return { value: Object.entries(inventory).map(([name, count]) => ({name, count, customName: options.named ? '专属装备' : null})) };
        const at = (args.args as Array<{x:number;y:number;z:number}>)[0];
        const found = blocks.get([at.x, at.y, at.z].join(','));
        return { value: found && !(options.hideRemoved && found.name === 'air') ? { ...found, position: at, stateId: 1 } : null };
      }
      const step = (args.steps as Record<string, any>[])[0]; actions++; writes.push(step);
      const denied = options.denyAt === actions;
      if (!denied && !options.noChange) {
        if (step.skill === 'harvest') {
          blocks.set(step.at.join(','), step.replant ? { name: step.block, properties: { age: 0 } } : { name: 'air', properties: {} });
          inventory[step.block === 'wheat' ? 'wheat' : step.block]++;
        } else if (step.skill === 'stow') inventory[step.item] -= step.count;
        else inventory[step.item] += step.count;
      }
      return { accepted: true, done: !denied, kind: denied ? 'blocked' : 'done', taskId: actions,
        steps: [{step:1,outcome:denied?'fail':'ok',why:denied?'denied':null}],
        receipt: denied ? 'server denied; no retry' : 'actual executor receipt', state: state() };
    } });
  return { runner, terminal, request, inventory, blocks, writes, state };
}

describe('reviewed Mineflayer work routines', () => {
  it('discovers source, conditions, schemas and stable source identity without a server or worker', () => {
    expect(listWorkRoutines().map(r => r.id)).toEqual(['farm_harvest', 'gather_logs', 'deposit_surplus', 'restock', 'navigate_route', 'swim_to', 'flight_route','swim_route','ride_route','portal_route']);
    const read = readWorkRoutine('farm_harvest');
    expect(read).toMatchObject({ version: 1, sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/), automaticallyReplayed: false });
    expect(read.code).toContain('await mc.do');
    (read.parameters as any).required = [];
    expect((readWorkRoutine('farm_harvest').parameters as any).required).toContain('cells');
    expect(() => prepareWorkRoutine('farm_harvest', { crop: 'wheat', cells: [cell] })).toThrow(/dimension/);
    for (const bad of [[], Array(9).fill(cell), [cell, cell], [['~1',64,0]], [[1,64]], [[1.5,64,0]]]) {
      expect(() => prepareWorkRoutine('farm_harvest', { dimension, crop: 'wheat', cells: bad })).toThrow();
    }
    expect(() => prepareWorkRoutine('gather_logs', { dimension, block: 'stripped_oak_log', cells: [cell] })).toThrow();
    expect(() => prepareWorkRoutine('restock', { dimension, chest: cell, items: [{item:'dirt',count:1},{item:'dirt',count:2}] })).toThrow(/重复/);
    expect(() => prepareWorkRoutine('restock', { dimension, chest: cell, items: [{item:'dirt',count:1,pick:'ignored'}] })).toThrow();
  });

  it('harvests only the explicit mature cells, replants, records actual inventory gain and keeps immature crops', async () => {
    const cells = [cell, [2,64,0], [3,64,0]], r = rig('farm_harvest', {dimension,crop:'wheat',cells});
    r.blocks.get('2,64,0')!.properties.age = '3';
    r.runner.start(r.request);
    const result = await r.terminal;
    expect(result).toMatchObject({ status: 'completed', routine: {id:'farm_harvest',version:1}, result: {
      outcome:'completed',goalCompleted:true,remaining:[],inventoryDelta:{wheat:2},records:[
        {at:cell,outcome:'ok',block:{name:'wheat',properties:{age:0}}},
        {at:[2,64,0],outcome:'noop',reason:'not_mature'}, {at:[3,64,0],outcome:'ok'},
      ] } });
    expect(r.writes).toHaveLength(2);
    expect(r.writes.every(step => step.skill === 'harvest' && step.replant)).toBe(true);
  });

  it.each([['unknown', null, 'target_unobserved'], ['wrong crop', {name:'carrots',properties:{age:7}}, 'target_changed']] as const)(
    'does not substitute a nearby resource when an exact cell is %s', async (_label, block, reason) => {
      const r = rig('farm_harvest',{dimension,crop:'wheat',cells:[cell]});
      if (block) r.blocks.set(cell.join(','), block as any); else r.blocks.delete(cell.join(','));
      r.runner.start(r.request);
      expect(await r.terminal).toMatchObject({status:'completed',result:{outcome:'blocked',goalCompleted:false,reason,remaining:[cell]}});
      expect(r.writes).toHaveLength(0);
    });

  it('does not treat dispatch or a completed executor operation without the block change as work success', async () => {
    const r = rig('gather_logs', {dimension,block:'oak_log',cells:[cell]}, {noChange:true});
    r.runner.start(r.request);
    expect(await r.terminal).toMatchObject({status:'completed',result:{outcome:'blocked',goalCompleted:false,reason:'postcondition_unconfirmed',remaining:[cell]}});
    expect(r.writes).toHaveLength(1);
  });

  it('keeps current occluded air unknown while retaining the explicit removal postcondition and real gain',async()=>{
    const r=rig('gather_logs',{dimension,block:'oak_log',cells:[cell]},{hideRemoved:true});
    r.runner.start(r.request);
    expect(await r.terminal).toMatchObject({result:{goalCompleted:true,inventoryDelta:{oak_log:1},records:[{
      block:null,verification:{source:'executor_postcondition',at:cell,block:'air'},outcome:'ok',changed:true,
    }]}});
    expect(r.writes[0].expect).toEqual({block:'air',at:cell});
  });

  it.each([null, undefined, '', false, 8])('keeps invalid crop age %j unknown rather than treating it as a seedling',async age=>{
    const r=rig('farm_harvest',{dimension,crop:'wheat',cells:[cell]});
    r.blocks.get(cell.join(','))!.properties.age=age;
    r.runner.start(r.request);
    expect(await r.terminal).toMatchObject({result:{goalCompleted:false,reason:'age_unknown'}});
    expect(r.writes).toHaveLength(0);
  });

  it('retains completed cells and stops immediately at a denied later cell without replay or continuing the batch', async () => {
    const cells = [cell,[2,64,0],[3,64,0]], r = rig('gather_logs',{dimension,block:'oak_log',cells},{denyAt:2});
    r.runner.start(r.request);
    expect(await r.terminal).toMatchObject({result:{outcome:'partial',goalCompleted:false,reason:'operation_blocked',remaining:cells.slice(1),inventoryDelta:{oak_log:1}}});
    expect(r.writes).toHaveLength(2);
  });

  it.each(['farm_harvest','gather_logs'])('fits the largest %s batch within the existing SDK/action budgets', async id => {
    const r = rig(id, {dimension,...(id === 'farm_harvest'?{crop:'wheat'}:{block:'oak_log'}),cells:Array.from({length:8},(_,i)=>[i+1,64,0])});
    r.runner.start(r.request);
    const result = await r.terminal;
    expect(result).toMatchObject({status:'completed',result:{goalCompleted:true}});
    expect(result.trace.length).toBeLessThanOrEqual(METHOD_LIMITS.calls);
    expect(r.writes).toHaveLength(8);
  });

  it('stores only surplus and restocks to a total, using observed quantities rather than adding the target count', async () => {
    const store = rig('deposit_surplus',{dimension,chest:cell,items:[{item:'dirt',count:4},{item:'bread',count:2}]});
    store.runner.start(store.request);
    expect(await store.terminal).toMatchObject({result:{goalCompleted:true,inventoryDelta:{dirt:-8}}});
    expect(store.writes).toEqual([{skill:'stow',item:'dirt',count:8,at:cell}]);
    const restock = rig('restock',{dimension,chest:cell,items:[{item:'dirt',count:16},{item:'bread',count:3}]});
    restock.runner.start(restock.request);
    expect(await restock.terminal).toMatchObject({result:{goalCompleted:true,inventoryDelta:{dirt:4,bread:3}}});
    expect(restock.writes.map(step => step.count)).toEqual([4,3]);
  });

  it('refuses ambiguous named surplus rather than stowing a special stack by its base item ID', async () => {
    const r = rig('deposit_surplus',{dimension,chest:cell,items:[{item:'dirt',count:0}]},{named:true});
    r.runner.start(r.request);
    expect(await r.terminal).toMatchObject({result:{goalCompleted:false,reason:'component_selection_required'}});
    expect(r.writes).toHaveLength(0);
  });

  it('reports uncertain or changed state without default health, empty inventory, or cross-dimension work', async () => {
    for (const patch of [{snapshot:null}, {snapshot:{...rig('restock',{dimension,chest:cell,items:[{item:'bread',count:1}]}).state().snapshot,health:null}},
      {snapshot:{dimension:'the_nether'}}, {snapshot:{dimension,invSynced:false}}]) {
      const request = prepareWorkRoutine('restock',{dimension,chest:cell,items:[{item:'bread',count:1}]});
      let writes=0, resolve!: (run:MethodRun)=>void;
      const ended = new Promise<MethodRun>(r => {resolve=r;});
      const runner = new MethodRunner({onFinish:resolve,call:async method => {
        if(method!=='state') writes++;
        return {sampledAt:'now',connectionGeneration:1,...patch};
      }});
      runner.start(request);
      expect(await ended).toMatchObject({status:'completed',result:{outcome:'blocked',goalCompleted:false}});
      expect(writes).toBe(0);
    }
  });

  it('runs through the actual tool and preserves cancellation while queued work has not executed', async () => {
    const r = methodHarness();
    try {
      const tool = r.world.tools().find(t => t.name === 'mc_script')!;
      const call = (args:Record<string,unknown>) => tool.handler(args,{role:'main',log:r.host.log});
      expect(await call({routine:{op:'list'}})).toContain('farm_harvest');
      expect(await call({routine:{op:'read',id:'restock'},stop:true})).toMatchObject({failed:true});
      const accepted = await call({routine:{op:'run',id:'restock'},params:{dimension,chest:cell,items:[{item:'bread',count:1}]},validate:true});
      expect(accepted).toMatchObject({execution:{terminal:false,goalCompleted:false}});
      expect(await methodEnded(r,r.runner.read().at(-1)!.id)).toMatchObject({status:'validated',trace:[]});
      r.set(1,64,0,'chest');
      const hold = r.exec.pauseForEnvironment('test hold');
      await call({routine:{op:'run',id:'restock'},params:{dimension,chest:cell,items:[{item:'bread',count:1}]}});
      const run = r.runner.read().at(-1)!;
      await new Promise(resolve=>setTimeout(resolve,100));
      await call({stop:true});
      const terminal=await methodEnded(r,run.id);
      expect(terminal,JSON.stringify(terminal)).toMatchObject({status:'cancelled'});
      r.exec.resumeAfterEnvironment(hold);
      expect(r.exec.currentTask).toBeNull();
    } finally {r.close();}
  });
});
