import type {Bot} from 'mineflayer';
import {Vec3} from 'vec3';
import {normalizeDimension} from './escape.ts';
import {SkillBlocked,checkAbort,sleep,type SkillContext} from './skill-context.ts';
import {groundInputSequence} from './skills-control.ts';
import type {WalkRoute} from './route-contract.ts';

/** Navigation uses loaded collision geometry; unknown is never free space. */
function corridorIssue(bot:Bot,p:Vec3,call:WalkRoute,padding=0):string|null{
 const half=.3+padding,low=p.y+.015,high=p.y+1.8;
 const avoid=new Set(call.avoid.map(p=>p.join(','))),names=new Set(call.avoidBlocks);
 for(let x=Math.floor(p.x-half);x<=Math.floor(p.x+half);x++)for(let z=Math.floor(p.z-half);z<=Math.floor(p.z+half);z++)
 for(let y=Math.floor(p.y-.08);y<=Math.floor(high-.001);y++){
  const b=bot.blockAt(new Vec3(x,y,z),false);
  if(!b)return `unknown-cell (${x},${y},${z})`;
  if(avoid.has([x,y,z].join(',')))return `avoid-cell (${x},${y},${z})`;
  if(names.has(b.name))return `avoid-block (${x},${y},${z})`;
  for(const s of b.shapes??[])if(x+s[0]<p.x+half-.001&&x+s[3]>p.x-half+.001&&z+s[2]<p.z+half-.001&&z+s[5]>p.z-half+.001&&y+s[1]<high-.001&&y+s[4]>low)
   return `obstructed (${x},${y},${z})`;
 }
 for(const x of [p.x-.28,p.x+.28])for(const z of [p.z-.28,p.z+.28]){
  const b=bot.blockAt(new Vec3(Math.floor(x),Math.floor(p.y-.05),Math.floor(z)),false);
  if(!b)return 'unknown-support';
  if(!(b.shapes??[]).some(s=>Math.abs(b.position.y+s[4]-p.y)<.06&&x>=b.position.x+s[0]&&x<=b.position.x+s[3]&&z>=b.position.z+s[2]&&z<=b.position.z+s[5]))return 'unsupported';
 }
 return null;
}
function lineIssue(bot:Bot,from:Vec3,to:Vec3,call:WalkRoute,padding=0):string|null{
 const n=Math.max(1,Math.ceil(from.distanceTo(to)/.1));
 for(let i=0;i<=n;i++){const p=from.plus(to.minus(from).scaled(i/n)),issue=corridorIssue(bot,p,call,padding);if(issue)return issue;}
 return null;
}

/** Follow the model's polyline in order, braking before each corner.
 * No implicit A*, jumping, block edits, trap activation or corner cutting. */
export async function followRoute(bot:Bot,call:WalkRoute,ctx:SkillContext):Promise<string>{
 checkAbort(ctx);
 const start=bot.entity?.position?.clone();
 if(!start)throw new SkillBlocked('尚未进入世界');
 if(call.dimension&&normalizeDimension(call.dimension)!==normalizeDimension(bot.game.dimension))throw new SkillBlocked('路线dimension与当前维度不符');
 const points=call.waypoints.map(p=>new Vec3(...p.at));
 let length=0,previous=start;
 for(const p of points){
  if(Math.abs(p.y-start.y)>.05)throw new SkillBlocked('follow_route 是同一脚高的精确地面折线；台阶、跳跃、游泳请单独规划，再从新落脚点继续');
  length+=previous.distanceTo(p);previous=p;
 }
 if(length>256)throw new SkillBlocked('精确路线总长超过256格；分成有明确恢复落点的局部路线');
 previous=start;
 for(const [i,p]of points.entries()){
  const issue=lineIssue(bot,previous,p,call,call.radius);
  if(issue)throw new SkillBlocked(`路线第${i+1}段预检受阻：${issue}；未执行路线，不自动绕行`,[],'local','route-obstructed');
  previous=p;
 }
 if(call.dryRun)return JSON.stringify({schema:'minecraft-walk-route/v1',dryRun:true,moved:false,goalCompleted:false,from:start,waypoints:call.waypoints,length,geometry:'loaded-client-collision',safeFuture:false});
 const began=Date.now(),reached:{index:number;position:Vec3;at:string}[]=[];
 let active=0,peak=0,lastProgress=start,lastProgressAt=began;
 const summary=()=>({schema:'minecraft-walk-route/v1',from:start,position:bot.entity.position.clone(),reached,nextWaypoint:active<points.length?active+1:null,elapsedMs:Date.now()-began,maxDisplacement:peak});
 try{return await groundInputSequence(bot,ctx,async input=>{
  for(const [i,target]of points.entries()){
   active=i;
   while(true){
    input.check();
    if(Date.now()-began>call.timeoutMs)throw new SkillBlocked('精确路线耗时已达本次预算；按实际位置重规划，不重放前段',[],'local','route-timeout');
    const p=bot.entity.position.clone(),v=bot.entity.velocity,speed=Math.hypot(v.x,v.z),distance=Math.hypot(target.x-p.x,target.z-p.z);
    peak=Math.max(peak,p.distanceTo(start));
    if(p.distanceTo(lastProgress)>.03){lastProgress=p;lastProgressAt=Date.now();}
    if(Date.now()-lastProgressAt>2000&&distance>call.radius)throw new SkillBlocked('精确路线按键仍执行但两秒无位置进展；先核对碰撞或服务端控制',[],'local','control-no-progress');
    if(Math.abs(p.y-start.y)>.15)throw new SkillBlocked('实际脚高已离开指定地面路线；停止输入，重新观察落脚点',[],'server','navigation-location-changed');
    const issue=lineIssue(bot,p,p.offset(v.x*2,0,v.z*2),call)||lineIssue(bot,p,target,call);
    if(issue)throw new SkillBlocked(`路线现场已变化：${issue}；在当前路点前停止，不自动改道`,[],'local','route-obstructed');
    if(distance<=call.radius&&speed<.035){input.keys([]);reached.push({index:i+1,position:p,at:new Date().toISOString()});break;}
    const brake=distance<=call.radius*.6+speed*1.65,posture=call.waypoints[i].posture;
    await bot.look(Math.atan2(-(target.x-p.x),-(target.z-p.z)),0,true);
    input.check();
    input.keys([...(brake?[]:['forward' as const]),...(posture==='sneak'?['sneak' as const]:posture==='sprint'&&!brake?['sprint' as const]:[])]);
    await sleep(50);
   }
  }
  active=points.length;
  return JSON.stringify({...summary(),arrived:true,goalCompleted:false,geometry:'loaded-client-collision',postures:call.waypoints.map(p=>p.posture)});
 });}
 catch(error){if(error instanceof SkillBlocked)throw new SkillBlocked(error.message,[...error.scene,JSON.stringify(summary())],error.source,error.code);throw error;}
 finally{ctx.diag?.write({lane:'body',event:'follow-route-ended',taskId:ctx.taskId,msg:JSON.stringify(summary()),data:{waypoints:call.waypoints}});}
}
