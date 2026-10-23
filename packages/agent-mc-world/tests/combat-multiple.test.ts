import {afterEach,expect,it,vi} from 'vitest';
import {CombatDecisionLoop,type CombatDecisionFrame,type CombatCandidate} from '../src/decisions/combat-decision.ts';
import {COMBAT_DECISION_DEFAULTS} from '../src/decisions/defaults.ts';
import {describeCombatDecision} from '../src/decisions/combat-display.ts';
const loops:CombatDecisionLoop[]=[];
afterEach(()=>{loops.splice(0).forEach(x=>x.stop());vi.useRealTimers();});
function choice(keys:string[],selected:string,p=.9){return{type:'choice',choice:selected,confidence:p,
  probabilities:Object.fromEntries(keys.map(key=>[key,key===selected?p:(1-p)/(keys.length-1)]))};}
function rig(body='option_3'){
  vi.useFakeTimers();
  const frame={battlefield:{sampledAtMs:Date.now(),connectionGeneration:1,dimension:'overworld',
    self:{entityId:1,health:{current:20,max:20,source:'native',updatedAtMs:0},food:20,position:[0,64,0],scoreboardTeam:null},
    action:{fighting:true,emergency:false,taskId:null,step:null,targetEntityId:7,canStep:true},actors:[],omitted:0,server:null},
    tacticRevision:1,mana:20,skills:[{spell:'bolt',available:true,manaCost:4,cooldownRemainingMs:0,block:null}],
    candidates:[{id:'step',kind:'step',intent:'Move sideways without stopping the attack',destination:[1,64,0]},
      {id:'bolt',kind:'cast',spell:'bolt',ruleId:'bolt',manaCost:4,intent:'Cast at the current enemy'},
      {id:'retreat',kind:'retreat',intent:'Withdraw from this fight'}],omittedCandidates:0} as CombatDecisionFrame;
  const cfg={...COMBAT_DECISION_DEFAULTS,enabled:true,mode:'act' as const,connection:'host' as const,timeoutMs:1000,maxAgeMs:1500};
  const sent:Array<{candidate:CombatCandidate;decisionId:string}>=[],reports:Array<{event:string;data:any}>=[];
  let mutate:((candidate:CombatCandidate)=>void)|undefined,request:any;
  const loop=new CombatDecisionLoop({config:()=>cfg,sample:()=>structuredClone(frame),
    request:async input=>{request=input;return{answers:{tactic:choice(Object.keys(input.questions.tactic!.criteria),body)}};},
    apply:(candidate,_frame,scope)=>{sent.push({candidate,decisionId:scope.decisionId});mutate?.(candidate);return true;},
    report:(event,data)=>reports.push({event,data})});loops.push(loop);
  return{loop,cfg,frame,sent,reports,get request(){return request;},mutate:(f:(c:CombatCandidate)=>void)=>{mutate=f;}};
}
it('uses one categorical combination option to dispatch a short step and one ready spell',async()=>{
  const r=rig();r.loop.tick();await vi.advanceTimersByTimeAsync(1);
  expect(Object.keys(r.request.questions)).toEqual(['tactic']);
  expect(Object.keys(r.request.questions.tactic.criteria)).toEqual(['keep','option_0','option_1','option_2','option_3']);
  expect(r.request.state.options.option_3).toEqual({kind:'combination',actions:['option_0','option_1']});
  expect(r.sent.map(x=>x.candidate.kind)).toEqual(['step','cast']);
  expect(r.sent[1]!.decisionId).toBe(r.sent[0]!.decisionId+':ability');
  const result=r.reports.find(x=>x.event==='result')!.data;
  expect(result.selections.map((x:any)=>x.application.dispatched)).toEqual([true,true]);
  expect(result.candidates).toHaveLength(2);expect(result.application.dispatched).toBe(true);
  const display=describeCombatDecision('result',result,r.frame);
  expect(display.actions).toEqual(['step','cast']);expect(display.text).toContain('短步移动 + 施法');expect(display.goalCompleted).toBe(false);
});
it('keeps a single spell option and reports its actual categorical distribution',async()=>{
  const r=rig('option_1');r.loop.tick();await vi.advanceTimersByTimeAsync(1);
  expect(r.sent.map(x=>x.candidate.kind)).toEqual(['cast']);
  const result=r.reports.find(x=>x.event==='result')!.data;
  expect(result).toMatchObject({choice:'option_1',probability:.9,confidence:.9,candidate:{kind:'cast'},application:{keptCurrent:false,dispatched:true}});
  expect(result.probabilities.option_1).toBe(.9);
});
it('offers retreat separately and never creates a retreat-plus-offensive-cast combination',async()=>{
  const r=rig('option_2');r.loop.tick();await vi.advanceTimersByTimeAsync(1);
  expect(r.sent.map(x=>x.candidate.kind)).toEqual(['retreat']);
  expect(Object.values(r.request.state.options).filter((v:any)=>v.kind==='combination')
    .every((v:any)=>!v.actions.includes('option_2'))).toBe(true);
  expect(r.reports.find(x=>x.event==='result')!.data.selections).toHaveLength(1);
});
it.each(['cooldown','configuration','connection'])('rechecks %s after the first action instead of blindly dispatching a pair',async change=>{
  const r=rig();r.mutate(c=>{if(c.kind!=='step')return;
    if(change==='cooldown')r.frame.candidates=r.frame.candidates.filter(x=>x.kind!=='cast');
    if(change==='configuration')r.cfg.enabled=false;
    if(change==='connection')r.frame.battlefield.connectionGeneration++;
  });
  r.loop.tick();await vi.advanceTimersByTimeAsync(1);
  expect(r.sent.map(x=>x.candidate.kind)).toEqual(['step']);
  const result=r.reports.find(x=>x.event==='result')!.data;
  expect(result.selections[0].application.dispatched).toBe(true);
  expect(result.selections[1].application.dispatched).toBe(false);
});
it('retains a confirmed first dispatch when the second acknowledgement is lost',async()=>{
  const r=rig();r.mutate(c=>{if(c.kind==='cast')throw Error('acknowledgement lost');});
  r.loop.tick();await vi.advanceTimersByTimeAsync(1);
  const result=r.reports.find(x=>x.event==='result')!.data;
  expect(result.application.dispatched).toBe(true);
  expect(result.selections[1]).toMatchObject({outcome:'dispatch-unknown',application:{dispatched:null}});
  expect(r.sent.filter(x=>x.candidate.kind==='step')).toHaveLength(1);
});
it('does not dispatch a spell after a failed or unconfirmed first component',async()=>{
  const r=rig();r.mutate(c=>{if(c.kind==='step')throw Error('first acknowledgement lost');});
  r.loop.tick();await vi.advanceTimersByTimeAsync(1);
  expect(r.sent.map(x=>x.candidate.kind)).toEqual(['step']);
  const result=r.reports.find(x=>x.event==='error')!.data;
  expect(result.application).toMatchObject({attempted:true,dispatched:null});
});
it('applies the probability floor to the whole combination before either primitive is dispatched',async()=>{
  const r=rig();r.cfg.minConfidence=.95;
  r.loop.tick();await vi.advanceTimersByTimeAsync(1);
  expect(r.sent).toHaveLength(0);
  expect(r.reports.find(x=>x.event==='result')!.data).toMatchObject({outcome:'uncertain',application:{attempted:false,dispatched:false}});
});
