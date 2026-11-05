import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { Battlefield } from './battlefield.ts';
import type { CombatCandidate } from './combat-decision-types.ts';
import { corridorSafe } from './idle-actions.ts';

const directions=['北','东北','东','东南','南','西南','西','西北'];
/** Optional model-selectable search, never an attack or a second planner.
 * Sound gives a coarse bearing; last-seen uses the recorded point, never the
 * hidden entity's live position. Alternative short corridors allow a checked
 * sidestep around an occluder. A new sample decides whether anything was found.
 */
export function combatSearchCandidates(bot:Bot,field:Battlefield,bodyFree:boolean,enabled:boolean):CombatCandidate[]{
  if(!enabled||!bodyFree||field.action.emergency||field.action.fighting||field.action.tracking
    ||(field.self.health.current??0)<=0
    ||field.actors.some(a=>a.relation==='hostile'&&a.health.current!==0&&a.lineOfSight===true))return [];
  const from=field.self.position,p=new Vec3(...from);
  for(const clue of field.clues??[]){
    if(clue.expiresAt<=field.sampledAtMs)continue;
    let dx:number,dz:number,key:string,description:string;
    if(clue.source==='sound-packet'){
      const at=directions.indexOf(clue.direction);
      if(at<0||!['怪物声','战斗声'].includes(clue.kind)||clue.heardAt>field.sampledAtMs
        ||!clue.origin||!clue.origin.every(Number.isFinite)||Math.hypot(...clue.origin.map((v,i)=>v-from[i]))>2)continue;
      dx=Math.sin(at*Math.PI/4);dz=-Math.cos(at*Math.PI/4);
      key=JSON.stringify([clue.source,clue.kind,clue.direction]);
      description=`a recent ${clue.kind} sound toward ${clue.direction} (${clue.distance}); source identity and current position unknown`;
    }else{
      if(clue.seenAt>field.sampledAtMs||!clue.position.every(Number.isFinite))continue;
      dx=clue.position[0]-from[0];dz=clue.position[2]-from[2];
      if(Math.hypot(dx,dz)<1.5)continue;
      key=JSON.stringify([clue.source,clue.key,clue.position]);
      description='a recently visible hostile\'s last-seen location; its current position is unknown';
    }
    const len=Math.hypot(dx,dz);if(!Number.isFinite(len)||len<.01)continue;
    const angle=Math.atan2(dz,dx);
    const candidates:CombatCandidate[]=[];
    for(const [i,offset]of [0,-Math.PI/4,Math.PI/4].entries()){
      const to=new Vec3(p.x+1.2*Math.cos(angle+offset),p.y,p.z+1.2*Math.sin(angle+offset));
      if(!corridorSafe(bot,p,to))continue;
      candidates.push({id:`search_${i}`,kind:'search',clueKey:key,source:clue.source,destination:[to.x,to.y,to.z],
        intent:`Investigate ${description}. Take one checked short ${i?'side':'forward'} step without attacking, then observe again.`.slice(0,240)});
    }
    if(candidates.length)return candidates;
  }
  return [];
}
