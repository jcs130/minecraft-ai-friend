import type { Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import { afterEach, expect, it, vi } from 'vitest';
import { methodHarness } from './method-harness.ts';
import { installPathfinderPerf } from '../core/pathfinder-perf.ts';
import { groundPathIssueOf, installDoorWaypointRepair } from '../core/path-waypoints.ts';
import type { TaskReport } from '../core/executor.ts';

afterEach(() => vi.useRealTimers());

it.each([
  {version:'1.21.1',guarded:false},{version:'1.21.1',guarded:true},
  {version:'1.20.6',guarded:false},{version:'1.20.6',guarded:true},
])('walks a valid compressed two-step climb on $version with geometry guard=$guarded', async ({version,guarded}) => {
  vi.useFakeTimers();
  const h=methodHarness(version),bot=h.bot as unknown as Bot,reports:TaskReport[]=[],paths:unknown[]=[];
  try {
    Object.assign(h.bot,{supportFeature:(name:string)=>h.bot.registry.supportFeature(name),getControlState:(key:string)=>h.keys[key],
      isAlive:true,dig:vi.fn(()=>{throw Error('Unexpected digging');}),placeBlock:vi.fn()});
    Object.assign(h.bot.game,{minY:-64,height:384});
    Object.assign(h.bot.world,{getBlockStateId:(at:any)=>h.bot.blockAt(at).stateId,getColumn:()=>({})});
    h.set(1,64,0,'stone');
    for(const x of [2,3])for(const y of [64,65])h.set(x,y,0,'stone');
    pathfinderPkg.pathfinder(bot);installPathfinderPerf();
    const movements=new pathfinderPkg.Movements(bot);movements.canDig=false;movements.allowParkour=false;
    movements.allow1by1towers=false;movements.scafoldingBlocks=[];movements.maxDropDown=2;
    bot.pathfinder.setMovements(movements);bot.pathfinder.tickTimeout=40;bot.pathfinder.thinkTimeout=2000;
    if(guarded)installDoorWaypointRepair(bot);
    bot.prependListener('path_update',(r:any)=>{
      if(r.status==='success'&&r.path.length>1){const last=r.path.at(-1);r.path.splice(0,r.path.length,last);}
      paths.push({status:r.status,at:h.bot.entity.position.clone(),onGround:h.bot.entity.onGround,path:r.path.slice(0,5).map((p:any)=>({x:p.x,y:p.y,z:p.z}))});
    });
    Object.assign((h.exec as any).opts,{report:(r:TaskReport)=>reports.push(r),fleeHealth:()=>0});
    await vi.advanceTimersByTimeAsync(500);
    expect(h.bot.entity.onGround).toBe(true);
    const admitted=h.exec.submitDetailed([{skill:'goto',at:[2,66,0],exact:true}]);
    expect(admitted.accepted).toBe(true);
    for(let i=0;i<1600&&!reports.length;i++)await vi.advanceTimersByTimeAsync(50);
    const detail={guarded,position:h.bot.entity.position,report:reports[0]?.text,kind:reports[0]?.kind,issue:groundPathIssueOf(bot),paths:paths.slice(-4)};
    expect(reports[0]?.kind,JSON.stringify(detail)).toBe('done');
    expect(h.bot.entity.position.y).toBeGreaterThanOrEqual(66);
    expect(h.bot.dig).not.toHaveBeenCalled();expect(h.bot.placeBlock).not.toHaveBeenCalled();
  } finally {h.close();}
},30000);
