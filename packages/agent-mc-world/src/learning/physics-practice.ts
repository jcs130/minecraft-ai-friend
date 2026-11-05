/** Offline Java 1.21.1 flat-ground practice. Collision physics, not a Minecraft server or damage simulator. */
import {createRequire} from 'node:module';
import {MethodLibrary} from '../../core/method-library.ts';
import {procedureHash} from '../../core/support/procedure.ts';
import {MethodPracticeExecutor,type PracticeBinding,type PracticeCase} from './practice.ts';
import {MotorSimulator} from '../motor/simulator.ts';
import {reconstructRecordedScene,recordedCase,type RecordedScene} from './recorded-scene.ts';
const require=createRequire(import.meta.url);
const {PlayerState}=require('prismarine-physics');
export function createPhysicsMethodPractice(options:{directory:string;binding:PracticeBinding;seeds?:number[];scenarios?:RecordedScene[]}) {
  if(options.scenarios&&(!Array.isArray(options.scenarios)||options.scenarios.length<2||options.scenarios.length>9))throw Error('Supply a recorded training case and distinct held-out cases');
  const seeds=options.seeds??[];
  if(!options.scenarios&&(!Array.isArray(options.seeds)||options.seeds.length<2||options.seeds.length>16
    ||new Set(options.seeds).size!==options.seeds.length))throw Error('Supply 2..16 distinct flat-ground seeds');
  const binding=structuredClone(options.binding);
  const scenarios=options.scenarios?.map(r=>structuredClone(r));
  const fixtures=scenarios?scenarios.map(recordedCase):seeds.map(seed=>{
    const s=new MotorSimulator('walk',seed);
    return {id:`walk-${seed}`,snapshotId:`walk-seed-${seed}`,environmentVersion:'java-1.21.1/prismarine-v1',
      goal:{kind:'reach',dimension:'overworld',position:{x:s.goal[0],y:s.goal[1],z:s.goal[2]},radius:.8,maxHealthLoss:0}} as PracticeCase;
  });
  const make=(i:number)=>scenarios?reconstructRecordedScene(scenarios[i]):Object.assign(new MotorSimulator('walk',seeds[i]),{dimension:'overworld',health:20,beforeTick:(_tick:number)=>{}});
  let simulator=make(0),ticks=0,resets=0,episodeTicks=0;
  const keys:Record<string,boolean>={forward:false,back:false,left:false,right:false,jump:false,sprint:false,sneak:false};
  const clear=()=>Object.keys(keys).forEach(k=>keys[k]=false);
  const library=new MethodLibrary(options.directory);
  const executor=new MethodPracticeExecutor({binding,library,
    reset:async fixture=>{
      const index=fixtures.findIndex(f=>procedureHash(f)===procedureHash(fixture));
      if(index<0)throw Error('Unknown or changed fixture');
      simulator=make(index);clear();episodeTicks=0;resets++;
    },
    observe:async fixture=>({at:Date.now(),instanceId:binding.instanceId,snapshotId:fixture.snapshotId,environmentVersion:fixture.environmentVersion,
      dimension:simulator.dimension,position:{x:simulator.player.entity.position.x,y:simulator.player.entity.position.y,z:simulator.player.entity.position.z},
      // This fixture defines constant health and empty inventory; it cannot validate combat or hazard survival.
      health:simulator.health,inventory:{}}),
    host:{nativeMethods:['look','setControlState','clearControlStates','waitForTicks','blockAt'],call:async(method,args,signal)=>{
      signal.throwIfAborted();const p=simulator.player.entity.position;
      if(method==='capabilities')return {version:'1.21.1',fixture:scenarios?'recorded-collision-physics':'flat-collision-physics',methods:['state','look','setControlState','clearControlStates','waitForTicks','blockAt'],maxCalls:32};
      if(method==='state')return {snapshot:{position:{x:p.x,y:p.y,z:p.z},health:simulator.health,velocity:simulator.player.entity.velocity,onGround:simulator.player.entity.onGround,inWater:simulator.player.entity.isInWater},target:{x:simulator.goal[0],y:simulator.goal[1],z:simulator.goal[2]}};
      if(method!=='mineflayer')throw Error('Fixture capability unavailable');
      const values=args.args as unknown[];
      if(!Array.isArray(values))throw Error('Invalid method arguments');
      if(args.name==='blockAt'){
        const v=values[0] as {x:number;y:number;z:number};if(!v||![v.x,v.y,v.z].every(Number.isFinite))throw Error('Invalid block position');
        const b=simulator.world.getBlock(v as any);return {value:{name:b.name,type:b.type,stateId:b.stateId,position:b.position,properties:b.getProperties()}};
      }
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
          signal.throwIfAborted();simulator.beforeTick(episodeTicks);const state=new PlayerState(simulator.player,keys);
          simulator.physics.simulatePlayer(state,simulator.world);state.apply(simulator.player);ticks++;episodeTicks++;
        }
        return {value:null};
      }
      throw Error('Unknown fixture method');
    }},settle:async()=>{clear();return 'settled';},
  });
  return {executor,library,fixtures:structuredClone(fixtures),stats:()=>({ticks,resets,heldKeys:Object.values(keys).filter(Boolean).length})};
}
