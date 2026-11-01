/** Bounded feedback from ORIGINAL trusted SDK traces, never the method's return value. */
export interface PracticeFeedback {
  /** Requested steps and unsuccessful mc.do groups, not completed action counts. */
  actionSteps:number; failedActions:number;
  failures:Array<{call:number;step:number|null;skill:string|null;outcome:string;why:string|null}>;
  truncated:boolean;
}
type Trace={call:number;method:string;args?:unknown;result?:unknown;error?:unknown};
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export function summarizePracticeTrace(trace:readonly Trace[]):PracticeFeedback {
  const feedback:PracticeFeedback={actionSteps:0,failedActions:0,failures:[],truncated:false};
  const short=(v:unknown):string|null=>{
    if(typeof v!=='string')return null;
    if(v.length>400)feedback.truncated=true;
    return v.slice(0,400);
  };
  const add=(row:PracticeFeedback['failures'][number])=>{
    if(feedback.failures.length<16)feedback.failures.push(row);else feedback.truncated=true;
  };
  for(const row of trace){
    if(row.method!=='do'){
      if(row.error)add({call:row.call,step:null,skill:null,outcome:'sdk-error',why:short(row.error)});
      continue;
    }
    const args=object(row.args),reply=object(row.result),steps=Array.isArray(args.steps)?args.steps:[];
    feedback.actionSteps+=steps.length;
    const failed=(Array.isArray(reply.steps)?reply.steps:[]).map(object).filter(s=>!['ok','noop','done'].includes(String(s.outcome)));
    if(reply.done===true&&!row.error&&!failed.length)continue;
    feedback.failedActions++;
    if(!failed.length)add({call:row.call,step:null,skill:null,outcome:short(reply.kind)??'incomplete',why:short(row.error)??short(reply.receipt)});
    for(const step of failed){
      const index=Number.isInteger(step.step)&&Number(step.step)>0?Number(step.step):null;
      add({call:row.call,step:index,skill:short(index===null?null:object(steps[index-1]).skill),
        outcome:short(step.outcome)??'unknown',why:short(step.why)??short(object(step.detail).text)});
    }
  }
  return feedback;
}
