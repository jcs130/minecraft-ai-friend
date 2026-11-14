/** Bounded observations along an existing journey. No model, movement or new goal is started here. */
export interface JourneyCue {
  kind:'npc'|'sign'|'landmark'; key:string; label:string; position:[number,number,number];
  source:'visible-entity'|'visible-block'|'server-event'; observedAtMs:number;
}
export interface JourneyIntent {taskId:number;stepIndex:number;destination:number[];dimension:string}
/** Short-lived route advice expiry; never overrides navigation or checkpoint safety. */
export interface JourneyChoicePolicy { choiceMinBlocks:number;choiceMaxBlocks:number;dangerChoiceMaxBlocks:number }
export const DEFAULT_JOURNEY_CHOICE_POLICY: Readonly<JourneyChoicePolicy> = {
  choiceMinBlocks:10,choiceMaxBlocks:20,dangerChoiceMaxBlocks:5,
};
export function journeyChoicePolicy(value?:Partial<JourneyChoicePolicy>):JourneyChoicePolicy {
  const finite=(value:unknown,fallback:number)=>typeof value==='number'&&Number.isFinite(value)?Math.max(1,Math.min(64,value)):fallback;
  const choiceMinBlocks=finite(value?.choiceMinBlocks,10);
  const choiceMaxBlocks=Math.max(choiceMinBlocks,finite(value?.choiceMaxBlocks,20));
  return {choiceMinBlocks,choiceMaxBlocks,dangerChoiceMaxBlocks:Math.min(choiceMaxBlocks,finite(value?.dangerChoiceMaxBlocks,5))};
}
export interface JourneySample {
  scope:string;generation:string;atMs:number;dimension:string;position:[number,number,number];
  intent:JourneyIntent|null;safeToConsider:boolean;cues:readonly JourneyCue[];
  /** Actual body medium, not a biome name or a complete navigable sea route. */
  surfaceWater?:boolean;
}
export interface JourneyOpportunity {
  schema:'agent-mc-journey-observation/v1';reason:'cue'|'progress'|'water';
  id:string;atMs:number;scope:string;generation:string;dimension:string;position:[number,number,number];
  journey:JourneyIntent;remainingBlocks:number;observations:JourneyCue[];
  /** Novel to this bounded notification index; not proof that the agent has never visited. */
  novelty:'not-recently-announced'|'progress-sample';choices:readonly ['continue','inspect'];goalCompleted:false;
  elapsedMs?:number;netProgressBlocks?:number;
}
const finite=(p:readonly number[])=>p.length===3&&p.every(Number.isFinite);
export class JourneyObserver {
  private route:{key:string;long:boolean;startedAt:number;noticeAt:number;noticePosition:[number,number,number];waterSince:number|null;waterNoticeAt:number|null}|null=null;
  private readonly seen=new Map<string,number>();
  private lastAt=-Infinity;
  private serial=0;
  private latest:JourneyOpportunity|null=null;
  constructor(private readonly options:{minTripBlocks?:number;minIntervalMs?:number;progressIntervalMs?:number}={}){}
  observe(sample:JourneySample):JourneyOpportunity|null {
    const {intent,position,dimension,atMs}=sample;
    if(!intent||!finite(position)||!Number.isFinite(atMs)||intent.dimension!==dimension
      ||![2,3].includes(intent.destination.length)||!intent.destination.every(Number.isFinite)){this.route=null;this.latest=null;return null;}
    const at=intent.destination,dx=at[0]!-position[0],dz=at.at(-1)!-position[2],remaining=Math.hypot(dx,dz);
    const key=JSON.stringify([sample.scope,sample.generation,dimension,intent.taskId,intent.stepIndex,at]);
    if(this.route?.key!==key){this.route={key,long:remaining>=(this.options.minTripBlocks??96),startedAt:atMs,noticeAt:atMs,noticePosition:[...position],waterSince:null,waterNoticeAt:null};this.latest=null;}
    if(sample.surfaceWater){this.route.waterSince??=atMs;}
    else {this.route.waterSince=null;this.route.waterNoticeAt=null;}
    if(!sample.safeToConsider||atMs-this.lastAt<(this.options.minIntervalMs??20_000))return null;
    for(const [key,time] of this.seen)if(atMs-time>600_000)this.seen.delete(key);
    const cues=sample.cues.filter(c=>finite(c.position)&&atMs>=c.observedAtMs&&atMs-c.observedAtMs<=10_000
      &&Math.hypot(...c.position.map((v,i)=>v-position[i]!))<=32&&c.key.length<=160&&c.label.length<=100);
    const noveltyKey=(c:JourneyCue)=>JSON.stringify([sample.scope,dimension,c.kind,
      // Different villagers/sign boards in the same small area form one encounter, not a wake-up each.
      Math.floor(c.position[0]/32),Math.floor(c.position[2]/32),c.kind==='npc'?c.label:c.key]);
    const water=this.route.long&&remaining>=96&&this.route.waterSince!==null&&atMs-this.route.waterSince>=10_000
      &&(this.route.waterNoticeAt===null||atMs-this.route.waterNoticeAt>=120_000);
    const fresh=!water&&this.route.long?cues.filter(c=>!this.seen.has(noveltyKey(c))).slice(0,3):[];
    const elapsedMs=atMs-this.route.startedAt,netProgressBlocks=Math.hypot(position[0]-this.route.noticePosition[0],position[2]-this.route.noticePosition[2]);
    const progress=!fresh.length&&atMs-this.route.noticeAt>=(this.options.progressIntervalMs??60_000)&&netProgressBlocks>=16;
    if(!water&&!fresh.length&&!progress)return null;
    if(water)this.route.waterNoticeAt=atMs;
    for(const c of fresh)this.seen.set(noveltyKey(c),atMs);
    while(this.seen.size>128)this.seen.delete(this.seen.keys().next().value!);
    this.lastAt=atMs;
    this.route.noticeAt=atMs;this.route.noticePosition=[...position];
    this.latest={schema:'agent-mc-journey-observation/v1',reason:water?'water':progress?'progress':'cue',
      id:`journey:${sample.generation}:${intent.taskId}:${intent.stepIndex}:${++this.serial}`,atMs,scope:sample.scope,
      generation:sample.generation,dimension,position:[...position],journey:structuredClone(intent),remainingBlocks:Math.round(remaining),
      observations:structuredClone(fresh),novelty:progress?'progress-sample':'not-recently-announced',choices:['continue','inspect'],goalCompleted:false,
      ...(progress?{elapsedMs,netProgressBlocks:Math.round(netProgressBlocks)}:{})};
    return structuredClone(this.latest);
  }
  reading(scope:string,generation:string,atMs=Date.now()):JourneyOpportunity|null {
    return this.latest&&this.latest.scope===scope&&this.latest.generation===generation&&atMs>=this.latest.atMs&&atMs-this.latest.atMs<=60_000
      ?structuredClone(this.latest):null;
  }
}
export function journeyOpportunityText(value:JourneyOpportunity,options:{guidance?:boolean}={}):string {
  if(value.reason==='water')return `[水路交通复核 ${value.id}｜采样 ${new Date(value.atMs).toISOString()}] `
    +`原任务#${value.journey.taskId}仍在前往 [${value.journey.destination.join(',')}]，约余${value.remainingBlocks}格；身体连续处于水面，当前未乘坐载具。`
    +'这是局部接触水的实测，不证明整段海域可通航。goto 正在游泳，不会自动造船或驾驶。'
    +(options.guidance===false?'':'现在可在原执行任务内重新比较交通方式：mc_options {"intent":"water"} 读取现有船、材料和工具；mc_script routine:{op:"read",id:"boat_trip"} 读取放船→上船→分段驾驶流程。'
      +'无船时先核对配方、材料或存放处；也可明确选择继续游泳/绕陆。选择乘船是替换行进方式，保留原目的地，不能把放船排到整条长途 goto 结束之后。身体转交用明确的 queue:"now"，先核对当前状态与被替换的队列；普通短暂进食可用 afterCheckpoint。');
  if(value.reason==='progress')return `[旅途进度 ${value.id}｜采样 ${new Date(value.atMs).toISOString()}] `
    +`原任务#${value.journey.taskId}仍在执行。已观察这段任务约${Math.floor((value.elapsedMs??0)/1000)}秒，`
    +`自上次提示位置净移约${value.netProgressBlocks??0}格，当前位置 [${value.position.map(n=>Math.round(n*10)/10).join(',')}]，采样时约余${value.remainingBlocks}格。未宣称到达。`
    +(options.guidance===false?'':'可在不停止移动的情况下核对身体与补给、读取信息并回应交流；独立普通 chat 使用默认队列且不带 needs/expect，可即时发送。需要身体短行动才用 afterCheckpoint，保留原任务。');
  const facts=value.observations.map(c=>`${c.label} (${c.position.map(Math.floor).join(',')})，来源 ${c.source}`).join('；');
  const reading=`[旅途发现 ${value.id}｜采样 ${new Date(value.atMs).toISOString()}] ${facts}。这些线索不证明村庄边界、入口可达或探索已完成。`
    +`原任务#${value.journey.taskId}第${value.journey.stepIndex+1}步仍是前往 [${value.journey.destination.join(',')}]，采样时约余${value.remainingBlocks}格。`;
  return reading+(options.guidance===false?'':'可继续赶路，也可先核对现场、告示牌与近期经历，判断是否值得停留。若选择短途探索，用 mc_do 的 queue:"afterCheckpoint" 插入一小段；安全落脚后让位，之后按原任务ID续程。不要用 stop/now 撤掉原旅途，也不要把这些线索当成新的强制目标。');
}
