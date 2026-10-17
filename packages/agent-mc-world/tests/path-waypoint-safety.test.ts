import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { checkGroundPath, groundPathIssueOf, installDoorWaypointRepair } from '../core/path-waypoints.ts';
import { gotoGoalOnce, goals } from '../core/travel.ts';
import { createRequire } from 'node:module';
import { methodHarness } from './method-harness.ts';
const node = (x: number,y: number,z=0.5) => ({x,y,z,toBreak:[],toPlace:[]});
function rig() {
  const bot = Object.assign(new EventEmitter(), { entity: { position: new Vec3(.5,64,.5), onGround:true, effects:{} },
    blockAt: (p: Vec3) => ({name:'air', position:p, getProperties:()=>({})}), clearControlStates() {},
    pathfinder: { goal: null as any, setGoal(goal: any) {this.goal=goal;}, goto: async (_goal:any) => {} } });
  installDoorWaypointRepair(bot as never); return bot;
}
describe('executable waypoint guard', () => {
  it('rejects a two-block rise after generation and propagates a script-geometry receipt even on empty-path resolve', async () => {
    const bot=rig(), result={status:'success',path:[node(1.5,66)]};
    bot.pathfinder.goto=async goal=>{bot.pathfinder.goal=goal;bot.emit('path_update',result);};
    await expect(gotoGoalOnce(bot as never,new goals.GoalBlock(1,66,0),{aborted:()=>false} as never)).rejects.toThrow(/路径内部几何校验/);
    expect(result.path).toEqual([]); expect(result.status).toBe('noPath');
    expect(groundPathIssueOf(bot)?.rise).toBe(2);
    expect(bot.entity.position).toEqual(new Vec3(.5,64,.5));
  });
  it('keeps a real staircase and treats future construction as unverified geometry', () => {
    const bot=rig();
    expect(checkGroundPath(bot as never,[node(1.5,65),node(2.5,66)])).toBeNull();
    const tower={...node(.5,65),toPlace:[{jump:true}]};
    expect(checkGroundPath(bot as never,[tower,node(1.5,67)])).toBeNull();
    bot.blockAt=p=>({name:'ladder',position:p,getProperties:()=>({})});
    expect(checkGroundPath(bot as never,[node(.5,66)])).toBeNull();
  });
  it('does not turn unknown chunks or an airborne start into an impossible-world claim', () => {
    const bot=rig(); bot.blockAt=()=>null as any;
    expect(checkGroundPath(bot as never,[node(1.5,66)])).toBeNull();
    bot.entity.onGround=false; bot.blockAt=p=>({name:'air',position:p,getProperties:()=>({})});
    expect(checkGroundPath(bot as never,[node(1.5,66)])).toBeNull();
  });
  it('does not disable geometry checks for an unrelated known potion effect', () => {
    const bot=rig(); Object.assign(bot,{registry:{effects:{1:{name:'NightVision'},2:{name:'JumpBoost'}}}});
    bot.entity.effects={1:{}};
    expect(checkGroundPath(bot as never,[node(1.5,66)])?.rise).toBe(2);
    bot.entity.effects={2:{}};
    expect(checkGroundPath(bot as never,[node(1.5,66)])).toBeNull();
  });
  it('certifies compressed half-stairs using real physics, while rejecting a wall or unknown collision', () => {
    const r=methodHarness('1.21.1');
    const req=createRequire(createRequire(import.meta.url).resolve('mineflayer'));
    const Block=req('prismarine-block')(r.bot.registry);
    const def=r.bot.registry.blocksByName.stone_brick_stairs;
    let stair:any;
    for(let id=def.minStateId;id<=def.maxStateId;id++) {
      const b=Block.fromStateId(id,0),p=b.getProperties();
      if(p.facing==='south'&&p.half==='bottom'&&p.shape==='straight'&&p.waterlogged===false){stair=b;break;}
    }
    expect(stair).toBeTruthy();
    const base=r.bot.blockAt;
    r.bot.blockAt=p=>{
      const cell=p.floored();
      if(cell.x===0&&((cell.z===0&&cell.y===64)||(cell.z===1&&cell.y===65))){
        const b=Block.fromStateId(stair.stateId,0);b.position=cell;return b;
      }
      return base(p);
    };
    r.bot.entity.position=new Vec3(.5,64.5,.15);r.bot.physicsEnabled=false;
    const goal=node(.5,66,1.85),before=r.bot.entity.position.clone();
    try {
      expect(checkGroundPath(r.bot as never,[goal])).toBeNull();
      expect(r.bot.entity.position).toEqual(before);expect(Object.values(r.keys).every(v=>!v)).toBe(true);
      const stairs=r.bot.blockAt;
      r.bot.blockAt=p=>p.floored().equals(new Vec3(0,65,1))?base(new Vec3(0,63,1)):stairs(p);
      expect(checkGroundPath(r.bot as never,[goal])?.rise).toBe(1.5);
      r.bot.blockAt=p=>p.floored().equals(new Vec3(0,65,1))?null as never:stairs(p);
      expect(checkGroundPath(r.bot as never,[goal])?.rise).toBe(1.5);
    } finally {r.close();}
  });
});
