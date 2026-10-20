/** Offline Java 1.21.1 flat-ground practice. Collision physics, not a Minecraft server or damage simulator. */
import {createRequire} from 'node:module';
import {MethodLibrary} from '../../core/method-library.ts';
import {procedureHash} from '../../core/support/procedure.ts';
import {MethodPracticeExecutor,type PracticeBinding,type PracticeCase} from './practice.ts';
import {MotorSimulator} from '../motor/simulator.ts';
const require=createRequire(import.meta.url);
const {PlayerState}=require('prismarine-physics');
export function createPhysicsMethodPractice(options:{directory:string;binding:PracticeBinding;seeds:number[]}) {
  if(!Array.isArray(options.seeds)||options.seeds.length<2||options.seeds.length>16
    ||new Set(options.seeds).size!==options.seeds.length)throw Error('Supply 2..16 distinct flat-ground seeds');
  const binding=structuredClone(options.binding);
  const fixtures=options.seeds.map(seed=>{
    const s=new MotorSimulator('walk',seed);
    return {id:`walk-${seed}`,snapshotId:`walk-seed-${seed}`,environmentVersion:'java-1.21.1/prismarine-v1',
      goal:{kind:'reach',dimension:'overworld',position:{x:s.goal[0],y:s.goal[1],z:s.goal[2]},radius:.8,maxHealthLoss:0}} as PracticeCase;
  });
  let simulator=new MotorSimulator('walk',options.seeds[0]),ticks=0,resets=0,episodeTicks=0;
  const keys:Record<string,boolean>={forward:false,back:false,left:false,right:false,jump:false,sprint:false,sneak:false};
  const clear=()=>Object.keys(keys).forEach(k=>keys[k]=false);
  const library=new MethodLibrary(options.directory);
  const executor=new MethodPracticeExecutor({binding,library,
    reset:async fixture=>{
      const index=fixtures.findIndex(f=>procedureHash(f)===procedureHash(fixture));
      if(index<0)throw Error('Unknown or changed fixture');
      simulator=new MotorSimulator('walk',options.seeds[index]);clear();episodeTicks=0;resets++;
    },
    observe:async fixture=>({at:Date.now(),instanceId:binding.instanceId,snapshotId:fixture.snapshotId,environmentVersion:fixture.environmentVersion,
      dimension:'overworld',position:{x:simulator.player.entity.position.x,y:simulator.player.entity.position.y,z:simulator.player.entity.position.z},
      // This fixture defines constant health and empty inventory; it cannot validate combat or hazard survival.
      health:20,inventory:{}}),
    host:{nativeMethods:['look','setControlState','clearControlStates','waitForTicks'],call:async(method,args,signal)=>{
      signal.throwIfAborted();const p=simulator.player.entity.position;
      if(method==='capabilities')return {version:'1.21.1',fixture:'flat-collision-physics',methods:['state','look','setControlState','clearControlStates','waitForTicks'],maxCalls:32};
      if(method==='state')return {snapshot:{position:{x:p.x,y:p.y,z:p.z},health:20},target:{x:simulator.goal[0],y:simulator.goal[1],z:simulator.goal[2]}};
      if(method!=='mineflayer')throw Error('Fixture capability unavailable');
      const values=args.args as unknown[];
      if(!Array.isArray(values))throw Error('Invalid method arguments');
      if(args.name==='look'){
        if(typeof values[0]!=='number'||!Number.isFinite(values[0])||typeof values[1]!=='number'||!Number.isFinite(values[1]))throw Error('Invalid look angles');
        simulator.player.entity.yaw=values[0];simulator.player.entity.pitch=values[1];return {value:null};
      }
      if(args.name==='setControlState'){
        if(typeof values[0]!=='string'||!Object.hasOwn(keys,values[0])||typeof values[1]!=='boolean')throw Error('Invalid control');
        keys[values[0]]=values[1];return {value:null};
      }
      if(args.name==='clearControlStates'){clear();return {value:null};}
      if(args.name==='waitForTicks'){
        const count=values[0];
        if(typeof count!=='number'||!Number.isInteger(count)||count<1||count>100||episodeTicks+count>1000)throw Error('Fixture tick budget exhausted');
        for(let i=0;i<count;i++){
          signal.throwIfAborted();const state=new PlayerState(simulator.player,keys);
          simulator.physics.simulatePlayer(state,simulator.world);state.apply(simulator.player);ticks++;episodeTicks++;
        }
        return {value:null};
      }
      throw Error('Unknown fixture method');
    }},settle:async()=>{clear();return 'settled';},
  });
  return {executor,library,fixtures:structuredClone(fixtures),stats:()=>({ticks,resets,heldKeys:Object.values(keys).filter(Boolean).length})};
}
