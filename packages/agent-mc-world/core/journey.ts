/** Bounded observations along an existing journey. No model, movement or new goal is started here. */
export interface JourneyCue {
  kind:'npc'|'sign'|'landmark'; key:string; label:string; position:[number,number,number];
  source:'visible-entity'|'visible-block'|'server-event'; observedAtMs:number;
}
export interface JourneyIntent {taskId:number;stepIndex:number;destination:number[];dimension:string}
export interface JourneySample {
  scope:string;generation:string;atMs:number;dimension:string;position:[number,number,number];
  intent:JourneyIntent|null;safeToConsider:boolean;cues:readonly JourneyCue[];
}
export interface JourneyOpportunity {
  id:string;atMs:number;scope:string;generation:string;dimension:string;position:[number,number,number];
  journey:JourneyIntent;remainingBlocks:number;observations:JourneyCue[];
  /** Novel to this bounded notification index; not proof that the agent has never visited. */
  novelty:'not-recently-announced';choices:readonly ['continue','inspect'];goalCompleted:false;
}
const finite=(p:readonly number[])=>p.length===3&&p.every(Number.isFinite);
export class JourneyObserver {
  private route:{key:string;long:boolean}|null=null;
  private readonly seen=new Map<string,number>();
  private lastAt=-Infinity;
  private serial=0;
  private latest:JourneyOpportunity|null=null;
  constructor(private readonly options:{minTripBlocks?:number;minIntervalMs?:number}={}){}
  observe(sample:JourneySample):JourneyOpportunity|null {
    const {intent,position,dimension,atMs}=sample;
    if(!intent||!finite(position)||!Number.isFinite(atMs)||intent.dimension!==dimension
      ||![2,3].includes(intent.destination.length)||!intent.destination.every(Number.isFinite)){this.route=null;this.latest=null;return null;}
    const at=intent.destination,dx=at[0]!-position[0],dz=at.at(-1)!-position[2],remaining=Math.hypot(dx,dz);
    const key=JSON.stringify([sample.scope,sample.generation,dimension,intent.taskId,intent.stepIndex,at]);
    if(this.route?.key!==key){this.route={key,long:remaining>=(this.options.minTripBlocks??96)};this.latest=null;}
    if(!this.route.long||!sample.safeToConsider||atMs-this.lastAt<(this.options.minIntervalMs??20_000))return null;
    for(const [key,time] of this.seen)if(atMs-time>600_000)this.seen.delete(key);
    const cues=sample.cues.filter(c=>finite(c.position)&&atMs>=c.observedAtMs&&atMs-c.observedAtMs<=10_000
      &&Math.hypot(...c.position.map((v,i)=>v-position[i]!))<=32&&c.key.length<=160&&c.label.length<=100);
    const noveltyKey=(c:JourneyCue)=>JSON.stringify([sample.scope,dimension,c.kind,
      // Different villagers/sign boards in the same small area form one encounter, not a wake-up each.
      Math.floor(c.position[0]/32),Math.floor(c.position[2]/32),c.kind==='npc'?c.label:c.key]);
    const fresh=cues.filter(c=>!this.seen.has(noveltyKey(c))).slice(0,3);
    if(!fresh.length)return null;
    for(const c of fresh)this.seen.set(noveltyKey(c),atMs);
    while(this.seen.size>128)this.seen.delete(this.seen.keys().next().value!);
    this.lastAt=atMs;
    this.latest={id:`journey:${sample.generation}:${intent.taskId}:${intent.stepIndex}:${++this.serial}`,atMs,scope:sample.scope,
      generation:sample.generation,dimension,position:[...position],journey:structuredClone(intent),remainingBlocks:Math.round(remaining),
      observations:structuredClone(fresh),novelty:'not-recently-announced',choices:['continue','inspect'],goalCompleted:false};
    return structuredClone(this.latest);
  }
  reading(scope:string,generation:string,atMs=Date.now()):JourneyOpportunity|null {
    return this.latest&&this.latest.scope===scope&&this.latest.generation===generation&&atMs>=this.latest.atMs&&atMs-this.latest.atMs<=60_000
      ?structuredClone(this.latest):null;
  }
}
export function journeyOpportunityText(value:JourneyOpportunity,options:{guidance?:boolean}={}):string {
  const facts=value.observations.map(c=>`${c.label} (${c.position.map(Math.floor).join(',')})，来源 ${c.source}`).join('；');
  const reading=`[旅途发现 ${value.id}｜采样 ${new Date(value.atMs).toISOString()}] ${facts}。这些线索不证明村庄边界、入口可达或探索已完成。`
    +`原任务#${value.journey.taskId}第${value.journey.stepIndex+1}步仍是前往 [${value.journey.destination.join(',')}]，采样时约余${value.remainingBlocks}格。`;
  return reading+(options.guidance===false?'':'可继续赶路，也可先核对现场、告示牌与近期经历，判断是否值得停留。若选择短途探索，用 mc_do 的 queue:"afterCheckpoint" 插入一小段；安全落脚后让位，之后按原任务ID续程。不要用 stop/now 撤掉原旅途，也不要把这些线索当成新的强制目标。');
}
