import type {ObservedEffect} from '../src/contracts/observed-effect.ts';

type Point = [number,number,number];
interface Step {
  step:number; outcome:string; why?:string|null;
  decision?:{reason?:string|null}; observedEffect?:ObservedEffect;
}
export interface TaskRecoveryEvidence {
  protocol:'agent-mc-task-recovery/v1'; scope:string; dimension:string;
  firstAt:number; lastAt:number; position:Point;
  attempts:Array<{executionId:string;step:number;skill:string;reason:string|null;outcome:string}>;
  historical:true; goalVerified:false; automaticReplay:false;
}
const point=(p:unknown):p is Point=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const distance=(a:Point,b:Point)=>Math.hypot(...a.map((v,i)=>v-b[i]));
/** Bounded native failure evidence. It never selects, cancels or replays an action. */
export class TaskRecoveryBook {
  private active:TaskRecoveryEvidence|null=null;
  private readonly seen=new Set<string>();
  constructor(private readonly options:{now?:()=>number;windowMs?:number}={}){}
  private now(){return this.options.now?.()??Date.now();}
  clear():void {this.active=null;this.seen.clear();}
  record(input:{scope:string;executionId:string;phase:string;steps:readonly Step[]}):TaskRecoveryEvidence|null {
    if(!['completed','blocked','partial'].includes(input.phase)||!input.scope||!input.executionId)return null;
    const key=`${input.scope}:${input.executionId}`;
    if(this.seen.has(key))return null;
    this.seen.add(key);while(this.seen.size>128)this.seen.delete(this.seen.values().next().value!);
    const physical=input.steps.filter(s=>s.observedEffect?.schema==='agent-mc-observed-effect/v1'
      &&!['chat','tell','look','wait','observe','probe'].includes(s.observedEffect.skill));
    const failed=physical.filter(s=>s.outcome==='fail'||s.outcome==='partial'
      ||s.outcome==='noop'&&s.observedEffect?.status==='unchanged');
    if(!failed.length){
      if(physical.some(s=>s.observedEffect?.status==='changed'))this.active=null;
      return null;
    }
    const s=failed.at(-1)!,e=s.observedEffect!;
    if(!point(e.before.position)||!point(e.after.position)||distance(e.before.position,e.after.position)>.5)return null;
    const now=this.now(),previous=this.current(input.scope,e.dimension,e.after.position);
    this.active={protocol:'agent-mc-task-recovery/v1',scope:input.scope,dimension:e.dimension,
      firstAt:previous?.firstAt??now,lastAt:now,position:previous?.position??[...e.after.position],
      attempts:[...(previous?.attempts??[]),{executionId:input.executionId,step:s.step,skill:e.skill,
        reason:(s.decision?.reason??s.why)?.slice(0,240)??null,outcome:s.outcome}].slice(-3),
      historical:true,goalVerified:false,automaticReplay:false};
    return this.active.attempts.length>=2?structuredClone(this.active):null;
  }
  current(scope:string,dimension:string,position:Point|null):TaskRecoveryEvidence|null {
    const a=this.active;
    return a&&position&&a.scope===scope&&a.dimension===dimension&&point(position)
      &&this.now()-a.lastAt<=(this.options.windowMs??120000)&&distance(a.position,position)<=.5?structuredClone(a):null;
  }
}
