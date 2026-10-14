import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { checkGroundPath, groundPathIssueOf, installDoorWaypointRepair } from '../core/path-waypoints.ts';
import { gotoGoalOnce, goals } from '../core/travel.ts';
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
});
