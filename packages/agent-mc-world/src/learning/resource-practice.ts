import { MethodLibrary } from '../../core/method-library.ts';
import { parseSteps } from '../../core/skills.ts';
import { procedureHash } from '../../core/support/procedure.ts';
import { getResourceActionContract } from '../collect-contract.ts';
import { MethodPracticeExecutor, type PracticeBinding, type PracticeCase } from './practice.ts';

export const RESOURCE_PRACTICE_ID = 'resource-acquisition';
export function resourcePracticeCapability(): string {
  return 'Isolated Java 1.21.1 resource acquisition. Goal: gain one oak_log over starting stock. '
    + 'Read mc.state().snapshot.entities[].item and inventory; bot.blockAt({x:1,y:64,z:0}) reads the visible adjacent cell. '
    + (['dropped-item', 'block'] as const).map(kind => {
      const contract = getResourceActionContract(kind);
      return `${kind}: ${contract.skill} (${contract.targetField}).`;
    }).join(' ')
    + ' Use mc.do(steps) and verify the inventory delta. The observed source varies between cases. '
    + 'Only local pickup and one-block collect are simulated; movement, crafting, combat, plugins and network latency are outside this environment.';
}

/** Same requested item, inventory and geometry. Only the source of the next item changes. */
export function createResourceMethodPractice(options:{directory:string;binding:PracticeBinding}) {
  const item = 'oak_log', initialCount = 2;
  const sources = ['dropped-item','block'] as const;
  const fixtures: PracticeCase[] = sources.map(source => ({
    id:'acquire-' + source, snapshotId:'stock-2-' + source,
    environmentVersion:'java-1.21.1/resource-acquisition-v1',
    goal:{kind:'inventory-gain',item,count:1,maxHealthLoss:0},
  }));
  let source:typeof sources[number], available=false, count=initialCount, taskId=0;
  const position={x:0,y:64,z:0}, cell={x:1,y:64,z:0};
  const state=()=>({snapshot:{
    dimension:'overworld', position:{...position}, invSynced:true, health:20,
    inventory:[{name:item,count}], blocksScanned:false, nearbyBlocks:[],
    entities:available && source==='dropped-item' ? [{
      entityId:21,name:'item',kind:'other',visible:true,direction:'east',dy:0,distance:1,
      item:{name:item,count:1},
    }] : [], entitiesOmitted:0,
  }});
  const executor=new MethodPracticeExecutor({
    binding:options.binding,library:new MethodLibrary(options.directory),
    async reset(fixture) {
      const index=fixtures.findIndex(known=>procedureHash(known)===procedureHash(fixture));
      if(index<0)throw Error('Unrecognized resource practice case');
      source=sources[index]; available=true; count=initialCount; taskId=0;
    },
    async observe(fixture) {
      return {at:Date.now(),instanceId:options.binding.instanceId,snapshotId:fixture.snapshotId,
        environmentVersion:fixture.environmentVersion,dimension:'overworld',position:{...position},health:20,inventory:{[item]:count}};
    },
    host:{nativeMethods:['blockAt'],async call(method,args,signal) {
      signal.throwIfAborted();
      if(method==='state')return state();
      if(method==='mineflayer' && args.name==='blockAt') {
        const p=(Array.isArray(args.args)?args.args[0]:null) as typeof cell|null;
        if(!p || p.x!==cell.x || p.y!==cell.y || p.z!==cell.z)return {value:null};
        return {value:{name:available && source==='block'?item:'air',position:{...cell},properties:{}}};
      }
      if(method!=='do')throw Error('Unsupported isolated resource practice operation');
      const parsed=parseSteps(args.steps);
      if('error' in parsed)return {accepted:false,done:false,kind:'rejected',receipt:parsed.error,state:state()};
      // Reject the entire group before mutation when it asks for an unmodelled feature.
      if(parsed.steps.some(step=> step.skill!=='pickup' && (step.skill!=='collect' || step.count!==1 ||
        step.tool!==undefined || step.buried===true || step.mature===true))) {
        return {accepted:false,done:false,kind:'rejected',receipt:'This isolated resource fixture supports pickup and single-block collect only.',state:state()};
      }
      const steps=[];
      for(const [i,step] of parsed.steps.entries()) {
        const matches = step.skill==='pickup'
          ? source==='dropped-item' && (step.item===undefined || step.item===item)
          : step.skill==='collect' && source==='block' && step.block===item;
        const gained=matches && available;
        if(gained){available=false;count++;}
        const outcome=gained?'ok':step.skill==='pickup'?'noop':'fail';
        steps.push({step:i+1,skill:step.skill,outcome,why:gained?null:'No matching resource observed in the fixture'});
        if(!gained)break;
      }
      const done=steps.length===parsed.steps.length && steps.every(s=>s.outcome!=='fail');
      return {accepted:true,taskId:++taskId,kind:done?'done':'blocked',done,
        receipt:steps.map(s=>s.skill+' '+s.outcome).join(', '),steps,state:state()};
    }},settle:async()=>'settled',
  });
  return {practice:executor,fixtures};
}
