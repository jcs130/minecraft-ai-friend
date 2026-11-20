import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { Battlefield } from './battlefield.ts';
import type { CombatCandidate } from './combat-decision-types.ts';
import { corridorSafe } from './idle-actions.ts';
import type { HearingHint } from './perception-hearing.ts';

const directions=['北','东北','东','东南','南','西南','西','西北'];

/** Recent observed starting points, not guessed enemy positions or cleared rooms. */
export class CombatSearchHistory {
  private scope = '';
  private points: Array<{key:string;at:number;position:[number,number,number]}> = [];
  private ambient?: { origin: [number,number,number]; expiresAt: number; attempts: Map<string,number> };
  private pending?: { taskId: number; evidence: string };
  private hurtAt = 0;
  private sync(scope:string, now:number):void {
    if(this.scope!==scope){this.scope=scope;this.points=[];this.ambient=undefined;this.pending=undefined;this.hurtAt=0;}
    this.points=this.points.filter(p=>now-p.at>=0&&now-p.at<30_000).slice(-64);
  }
  record(scope:string,key:string,position:[number,number,number],now:number):void {
    this.sync(scope,now);
    this.points.push({key,position:[...position],at:now});
  }
  filter(scope:string,candidates:CombatCandidate[],now:number):CombatCandidate[]{
    this.sync(scope,now);
    return candidates.filter(c=>c.kind!=='search'||!this.points.some(p=>p.key===c.clueKey
      &&Math.abs(p.position[1]-c.destination[1])<1
      &&Math.hypot(p.position[0]-c.destination[0],p.position[2]-c.destination[2])<.9));
  }

  /** A bearing changes as the listener walks. A new distance band or combat sound is different evidence. */
  observe(scope: string, field: Battlefield, hurtAt: number): void {
    this.sync(scope,field.sampledAtMs);
    const hints = (field.clues ?? []).filter((c): c is HearingHint => c.source === 'sound-packet'
      && (c.kind === '怪物声' || c.kind === '战斗声') && c.expiresAt > field.sampledAtMs && c.heardAt <= field.sampledAtMs);
    const fresh = hints.reduce<HearingHint | undefined>((a,c) => !a || c.heardAt > a.heardAt ? c : a,undefined);
    const seen = field.actors.some(a => a.relation === 'hostile' && a.lineOfSight === true && a.health.current !== 0);
    const last=this.ambient;
    const movedAway = last && Math.hypot(...field.self.position.map((v,i) => v-last.origin[i])) > 16;
    // Hearing snapshots are bounded. An omitted clue is not yet proof of a quiet interval.
    const quietGap = last && (fresh?.heardAt ?? field.sampledAtMs)>last.expiresAt;
    if (seen || hurtAt > this.hurtAt || movedAway || quietGap) {
      this.ambient = undefined;
      this.pending = undefined;
    }
    this.hurtAt = hurtAt;
    if (!fresh || seen) return;
    this.ambient ??= {origin:[...field.self.position],expiresAt:fresh.expiresAt,attempts:new Map()};
    this.ambient.expiresAt = Math.max(this.ambient.expiresAt,fresh.expiresAt);
  }

  allowSound(hint: HearingHint, competingGoal: boolean): boolean {
    // Without a competing goal a short search can check more than one safe corridor.
    // Renewing a packet or rotating through eight bearings does not re-arm a spent investigation.
    const count = this.ambient?.attempts.get(JSON.stringify([hint.kind,hint.distance])) ?? 0;
    return count < (competingGoal ? 1 : 3);
  }

  submitted(taskId: number, candidate: Extract<CombatCandidate,{kind:'search'}>, field: Battlefield): void {
    if (candidate.source !== 'sound-packet' || !this.ambient) return;
    const hint = field.clues?.find((c): c is HearingHint => c.source === 'sound-packet'
      && soundKey(c) === candidate.clueKey);
    if (hint) this.pending = {taskId,evidence:JSON.stringify([hint.kind,hint.distance])};
  }

  terminal(taskId: number, attempted: boolean): void {
    if (taskId !== this.pending?.taskId) return;
    const evidence = this.pending.evidence;
    this.pending = undefined;
    if (attempted && this.ambient) this.ambient.attempts.set(evidence,(this.ambient.attempts.get(evidence) ?? 0)+1);
  }
}
const soundKey=(hint:HearingHint)=>JSON.stringify([hint.source,hint.kind,hint.direction]);
/** Optional model-selectable search, never an attack or a second planner.
 * Sound gives a coarse bearing; last-seen uses the recorded point, never the
 * hidden entity's live position. Alternative short corridors allow a checked
 * sidestep around an occluder. A new sample decides whether anything was found.
 */
export function combatSearchCandidates(bot:Bot,field:Battlefield,bodyFree:boolean,enabled:boolean,
  allowSound?: (hint:HearingHint)=>boolean):CombatCandidate[]{
  if(!enabled||!bodyFree||field.action.emergency||field.action.fighting||field.action.tracking
    ||(field.self.health.current??0)<=0
    ||field.actors.some(a=>a.relation==='hostile'&&a.health.current!==0&&a.lineOfSight===true))return [];
  const from=field.self.position,p=new Vec3(...from);
  // A recorded contact takes precedence over unrelated ambient monster sounds.
  const clues=[...(field.clues??[])].sort((a,b)=>Number(b.source==='last-seen')-Number(a.source==='last-seen'));
  for(const clue of clues){
    if(clue.expiresAt<=field.sampledAtMs)continue;
    let dx:number,dz:number,key:string,description:string;
    if(clue.source==='sound-packet'){
      if(allowSound && !allowSound(clue))continue;
      const at=directions.indexOf(clue.direction);
      if(at<0||!['怪物声','战斗声'].includes(clue.kind)||clue.heardAt>field.sampledAtMs
        ||!clue.origin||!clue.origin.every(Number.isFinite)||Math.hypot(...clue.origin.map((v,i)=>v-from[i]))>2)continue;
      dx=Math.sin(at*Math.PI/4);dz=-Math.cos(at*Math.PI/4);
      key=soundKey(clue);
      description=`a recent ${clue.kind} sound toward ${clue.direction} (${clue.distance}); source identity and current position unknown`;
    }else{
      if(clue.seenAt>field.sampledAtMs||!clue.position.every(Number.isFinite))continue;
      dx=clue.position[0]-from[0];dz=clue.position[2]-from[2];
      if(Math.hypot(dx,dz)<1.5)continue;
      key=JSON.stringify([clue.source,clue.key]);
      description='a recently visible hostile\'s last-seen location; its current position is unknown';
    }
    const len=Math.hypot(dx,dz);if(!Number.isFinite(len)||len<.01)continue;
    const angle=Math.atan2(dz,dx);
    const candidates:CombatCandidate[]=[];
    for(const [i,offset]of [0,-Math.PI/4,Math.PI/4,-Math.PI/2,Math.PI/2].entries()){
      const to=new Vec3(p.x+1.2*Math.cos(angle+offset),p.y,p.z+1.2*Math.sin(angle+offset));
      if(!corridorSafe(bot,p,to))continue;
      candidates.push({id:`search_${i}`,kind:'search',clueKey:key,source:clue.source,destination:[to.x,to.y,to.z],
        intent:`Investigate ${description}. Take one checked short ${i?'side':'forward'} step without attacking, then observe again.`.slice(0,240)});
    }
    if(candidates.length)return candidates;
  }
  const objective=field.searchObjective;
  if(objective&&objective.remaining>0&&objective.observedAtMs<=field.sampledAtMs&&objective.expiresAtMs>field.sampledAtMs){
    return [0,Math.PI/2,Math.PI,Math.PI*1.5].flatMap((angle,i)=>{
      const to=new Vec3(p.x+1.2*Math.cos(angle),p.y,p.z+1.2*Math.sin(angle));
      return corridorSafe(bot,p,to)?[{id:`search_area_${i}`,kind:'search' as const,source:'objective' as const,
        clueKey:objective.key,destination:[to.x,to.y,to.z] as [number,number,number],
        intent:`Server reports ${objective.remaining} enemies remaining, locations unknown. Check a short safe corridor toward ${['east','south','west','north'][i]}, then observe again; this is search, not an attack or proof of a clear room.`}]:[];
    });
  }
  return [];
}
