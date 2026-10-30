/** Passive metadata about autonomous model rounds; never chooses actions or closes goals. */
import {createHash} from 'node:crypto';
export interface DecisionRound {
  run:string;goalId:string;turn:number;at:number;completed:boolean;autonomous:boolean;goalActive:boolean;hadToolCall:boolean;
  toolsAvailable:number|null;response:{hash:string;chars:number}|null;
  execution:{protocol:string;scope:string;run:string;generation:number;phase:string;revision:string;
    activeCount:number;pendingCalls:number;pendingTactics:number;detachedCount:number;observedAt:number}|null;
}
export interface DecisionReview {
  protocol:'agent-mc-decision-review/v1';key:string;run:string;goalId:string;generation:number;executionRevision:string;
  firstTurn:number;latestTurn:number;firstAt:number;lastAt:number;noToolRounds:number;sameResponseRounds:number;
  responseHash:string;responseChars:number;knownIdle:true;idleScope:'registered-current-runtime';
  toolsAvailable:number;historical:true;goalVerified:false;reviewNeeded:boolean;guidance:string;
}
export class DecisionReviewBook {
  private current:DecisionReview|null=null;
  constructor(private readonly options:{now?:()=>number;threshold?:number;windowMs?:number}={}){
    if(!Number.isSafeInteger(options.threshold??3)||(options.threshold??3)<2)throw Error('Invalid decision review threshold');
  }
  private now(){return this.options.now?.()??Date.now();}
  recordRound(input:DecisionRound):void{
    const e=input.execution,r=input.response,now=this.now();
    const idle=e?.protocol==='agent-mc-execution-state/v1'&&e.scope==='runtime-receipts'&&e.run===input.run&&e.phase==='started'
      &&Number.isSafeInteger(e.generation)&&e.generation>0&&/^[a-f0-9]{64}$/.test(e.revision)
      &&[e.activeCount,e.pendingCalls,e.pendingTactics,e.detachedCount].every(n=>n===0)
      &&Number.isFinite(e.observedAt)&&now-e.observedAt>=-5000&&now-e.observedAt<=15000;
    if(input.completed!==true||input.autonomous!==true||input.goalActive!==true||input.hadToolCall!==false||!idle||!r||!/^[a-f0-9]{64}$/.test(r.hash)
      ||!Number.isSafeInteger(r.chars)||r.chars<0||!Number.isSafeInteger(input.toolsAvailable)||(input.toolsAvailable??0)<1
      ||!Number.isSafeInteger(input.turn)||input.turn<0||!Number.isFinite(input.at)||input.at>now+5000
      ||now-input.at>(this.options.windowMs??300000)||typeof input.run!=='string'||!input.run||input.run.length>160
      ||typeof input.goalId!=='string'||!input.goalId||input.goalId.length>240){this.current=null;return;}
    const prior=this.current,same=prior?.run===input.run&&prior.goalId===input.goalId&&prior.generation===e!.generation&&prior.executionRevision===e!.revision;
    if(same&&input.turn<=prior!.latestTurn)return;
    const continuing=same&&input.at-prior!.lastAt>=0&&input.at-prior!.lastAt<=(this.options.windowMs??300000);
    const firstTurn=continuing?prior!.firstTurn:input.turn,firstAt=continuing?prior!.firstAt:input.at;
    const noToolRounds=continuing?Math.min(prior!.noToolRounds+1,1000000):1;
    this.current={protocol:'agent-mc-decision-review/v1',key:'decision:'+createHash('sha256').update(JSON.stringify([input.run,input.goalId,e!.generation,e!.revision,firstTurn])).digest('hex'),
      run:input.run,goalId:input.goalId,generation:e!.generation,executionRevision:e!.revision,firstTurn,latestTurn:input.turn,firstAt,lastAt:input.at,noToolRounds,
      sameResponseRounds:continuing&&prior!.responseHash===r.hash?Math.min(prior!.sameResponseRounds+1,1000000):1,
      responseHash:r.hash,responseChars:r.chars,knownIdle:true,idleScope:'registered-current-runtime',toolsAvailable:input.toolsAvailable!,historical:true,goalVerified:false,
      reviewNeeded:noToolRounds>=(this.options.threshold??3),
      guidance:'The active autonomous goal has received model replies without any tool call while the current runtime reports no registered work. An acknowledgement is not execution or progress. Reconcile original receipts and current facts, then choose the next feasible step yourself; if intentional waiting or a real blocker prevents action, state its evidence and a bounded wake condition. Do not repeat acknowledgements, fabricate success, replay unknown work or infer that all historical actions are idle.'};
  }
  context(run:string,goalId:string):DecisionReview|null{
    const s=this.current;return s&&s.run===run&&s.goalId===goalId&&this.now()-s.lastAt<=(this.options.windowMs??300000)?structuredClone(s):null;
  }
  priority(run:string,goalId:string):DecisionReview|null{const s=this.context(run,goalId);return s?.reviewNeeded?s:null;}
}
