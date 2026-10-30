import { afterEach, describe, expect, it, vi } from 'vitest';
import pathfinderPkg from 'mineflayer-pathfinder';
import type { Bot } from 'mineflayer';
import { MinecraftWorld } from '../core/world.ts';
import { MINECRAFT_DEFAULTS } from '../core/config.ts';
import type { ServerQueryDefinition } from '../core/server-query.ts';
import type { ToolCallContext, ToolOutcome } from '../core/support/host-contract.ts';
import { methodHarness } from './method-harness.ts';

const accessDenied = 'MC_LAND_ACCESS {"status":"deny","allowed":false,"reason":"land_permission_denied","action":"place","dimension":"minecraft:overworld","x":4,"y":64,"z":0}';
const accessDeniedText = 'CHECK 你不能破坏这里的方块';

class QueryWorld extends MinecraftWorld {
  protected override serverQueryDefinitions(): readonly ServerQueryDefinition[] {
    return [{ id:'self',description:'Fixture personal query',command:args=>args.length===0?'/fixture state':null,
      matchReply:(text,_args,username)=>text===`STATE ${username}` || text===`STATE ${username} 还需 9 秒`
        ?{data:{owner:username},ok:true}:null },
      { id:'access',description:'Read-only fixture permission query',command:args=>args.length===0?'/fixture query-access':null,
        matchReply:text=>text===accessDenied || text===accessDeniedText ? {ok:false}:null }];
  }
  clearQueries() { this.serverQueries.reset('fixture connection lost'); }
}
const rigs: ReturnType<typeof methodHarness>[]=[];
afterEach(()=>{rigs.splice(0).forEach(r=>{(r.world as QueryWorld).clearQueries();r.close();});vi.useRealTimers();});
function rig() {
  const r=methodHarness('1.21.1',()=>new QueryWorld({cfg:structuredClone(MINECRAFT_DEFAULTS)}));rigs.push(r);
  Object.assign(r.bot,{username:'Fixture',supportFeature:(name:string)=>r.bot.registry.supportFeature(name),swingArm(){}});
  (r.world as any).hookedBots.add(r.bot);(r.world as any).hookMessageEvents(r.bot);
  return r;
}
async function call(r:ReturnType<typeof rig>,args:Record<string,unknown>) {
  return await r.world.tools().find(t=>t.name==='mc_query')!.handler(args,{} as ToolCallContext) as ToolOutcome;
}
async function until(test:()=>boolean) {
  const end=Date.now()+4000;
  while(!test()){if(Date.now()>end)throw new Error('fixture timed out');await new Promise(r=>setTimeout(r,10));}
}
describe('independent server query through the public World tool',()=>{
  it('uses the configured query IDs in the mounted tool schema without adding an execution barrier', () => {
    const r = rig();
    const tool = r.world.tools().find(tool => tool.name === 'mc_query')!;
    expect(tool.parameters.properties).toMatchObject({ query: { enum: ['self', 'access'] } });
    expect(tool.barrierAfter).not.toBe(true);
    expect(tool.endsTurn).not.toBe(true);
    expect(r.said).toEqual([]);
  });
  it('sends during real pathfinder movement, preserving navigation and queued commands',async()=>{
    const r=rig();pathfinderPkg.pathfinder(r.bot as unknown as Bot);
    const run=r.runner.start({name:'query-while-walking',code:'await bot.pathfinder.goto(new goals.GoalBlock(30,64,0));'});
    await until(()=>r.bot.pathfinder.goal!==null);
    r.exec.submit([{skill:'chat',text:'/fixture mutate'}],'append');
    const task=r.exec.currentTask!.id,goal=r.bot.pathfinder.goal,x=r.bot.entity.position.x;
    const sent=await call(r,{query:'self'});
    expect(sent.data).toMatchObject({phase:'sent',goal_completed:false});
    expect(r.said).toEqual(['/fixture state']);
    expect(r.exec.currentTask?.id).toBe(task);expect(r.bot.pathfinder.goal).toBe(goal);
    expect(r.runner.read(run.id)[0]?.status).toBe('running');
    await until(()=>r.bot.entity.position.x>x+.2);
    const same=await call(r,{query:'self'});expect(same.data).toMatchObject({requestId:(sent.data as any).requestId});
    expect(r.said).toHaveLength(1);
    r.bot.emit('message',{toString:()=> 'STATE Fixture'},'system');await Promise.resolve();
    expect((await call(r,{requestId:(sent.data as any).requestId})).data).toMatchObject({phase:'replied',goal_completed:false});
    expect(r.exec.currentTask?.id).toBe(task);expect(r.said).not.toContain('/fixture mutate');
  },7000);
  it('rejects player quotes and wrong sender packets even with matching reply text',async()=>{
    const r=rig(),sent=await call(r,{query:'self'}),requestId=(sent.data as any).requestId;
    r.bot.players={Jojo:{username:'Jojo',uuid:'uuid-player'}} as never;
    const quote={toString:()=> 'STATE Fixture'};
    r.bot.emit('message',quote,'system');r.bot.emit('chat','Jojo','STATE Fixture','',quote);
    r.bot.emit('message',{toString:()=> 'STATE Fixture'},'system','uuid-player');
    await Promise.resolve();expect((await call(r,{requestId})).data).toMatchObject({phase:'sent'});
    r.bot.emit('message',{toString:()=> 'STATE Fixture'},'system');await Promise.resolve();
    expect((await call(r,{requestId})).data).toMatchObject({phase:'replied'});
  });
  it('does not send unsupported or mutating commands; disconnected calls keep current tasks',async()=>{
    const r=rig();
    expect((await call(r,{query:'leave'})).failed).toBe(true);
    expect((await call(r,{query:'self',arguments:[';start']})).failed).toBe(true);
    (r.world as any).bridge.connected=false;
    expect((await call(r,{query:'self'})).failed).toBe(true);
    expect(r.said).toHaveLength(0);
  });
  it('does not associate an earlier received message whose attribution runs after dispatch',async()=>{
    const r=rig();
    r.bot.emit('message',{toString:()=> 'STATE Fixture'},'system');
    const pending=call(r,{query:'self'});
    const sent=await pending,requestId=(sent.data as any).requestId;
    await Promise.resolve();expect((await call(r,{requestId})).data).toMatchObject({phase:'sent'});
    r.bot.emit('message',{toString:()=> 'STATE Fixture'},'system');await Promise.resolve();
    expect((await call(r,{requestId})).data).toMatchObject({phase:'replied'});
  });
  it('preserves the body command wait association while an independent read is sent',async()=>{
    const r=rig(),guard=(r.world as any).serverActionWait;
    guard.noteChat('/fixture start');
    await call(r,{query:'self'});
    guard.noteFeedback('还需 7 秒');
    expect(guard.blockChat('/fixture start')).toContain('7 秒');
    expect(guard.blockChat('/fixture state')).toBeNull();
  });
  it('does not mistake a query cooldown description for a body-action wait',async()=>{
    const r=rig(),guard=(r.world as any).serverActionWait;
    guard.noteChat('/fixture start');
    const sent=await call(r,{query:'self'});
    r.bot.emit('message',{toString:()=> 'STATE Fixture 还需 9 秒'},'system');await Promise.resolve();
    expect((await call(r,{requestId:(sent.data as any).requestId})).data).toMatchObject({phase:'replied'});
    expect(guard.blockChat('/fixture start')).toBeNull();
  });
  it.each([accessDenied,accessDeniedText])('isolates a correlated permission query reply from body denial and task feedback: %s',async reply=>{
    const r=rig();pathfinderPkg.pathfinder(r.bot as unknown as Bot);
    const run=r.runner.start({name:'query-denial-while-walking',code:'await bot.pathfinder.goto(new goals.GoalBlock(30,64,0));'});
    await until(()=>r.bot.pathfinder.goal!==null);
    const task=r.exec.currentTask!.id,goal=r.bot.pathfinder.goal;
    const deny=vi.fn(()=>true),breakDenied=vi.fn();
    Object.assign((r.world as any).bridge,{noteServerActionDenied:deny,noteServerBreakDenied:breakDenied});
    const block=vi.spyOn(r.exec,'blockCurrentFromServer');
    const sent=await call(r,{query:'access'});
    r.bot.emit('message',{toString:()=>reply},'system');await Promise.resolve();
    expect((await call(r,{requestId:sent.data!.requestId}))).toMatchObject({failed:true,data:{phase:'replied',reply:{ok:false}}});
    expect(deny).not.toHaveBeenCalled();expect(breakDenied).not.toHaveBeenCalled();expect(block).not.toHaveBeenCalled();
    expect((r.world as any).serverFeedback.forTask(task)).toBe('');
    expect(r.exec.currentTask?.id).toBe(task);expect(r.bot.pathfinder.goal).toBe(goal);
    expect(r.runner.read(run.id)[0]?.status).toBe('running');
    // A subsequent genuine body-action denial still goes through the original lifecycle.
    r.bot.emit('message',{toString:()=>accessDenied},'system');await Promise.resolve();
    expect(deny).toHaveBeenCalledOnce();expect(block).toHaveBeenCalledOnce();
    expect((r.world as any).serverFeedback.forTask(task)).toContain('land_permission_denied');
  },7000);
  it('correlates a transport-synchronous reply after the World provenance microtask',async()=>{
    const r=rig();
    r.bot.chat=()=>{r.bot.emit('message',{toString:()=> 'STATE Fixture'},'system');};
    const sent=await call(r,{query:'self'});
    await Promise.resolve();
    expect((await call(r,{requestId:sent.data!.requestId})).data).toMatchObject({phase:'replied',goal_completed:false});
  });
  it.each(['replied','timeout','send_failed','cancelled'] as const)('publishes one %s query terminal with an appropriate recovery trigger',async phase=>{
    vi.useFakeTimers();
    const r=rig();
    if(phase==='send_failed')r.bot.chat=()=>{throw new Error('fixture transport unavailable');};
    const sent=await call(r,{query:'self'}),requestId=sent.data!.requestId;
    if(phase==='replied') {r.bot.emit('message',{toString:()=> 'STATE Fixture'},'system');await Promise.resolve();}
    if(phase==='timeout')vi.advanceTimersByTime(5000);
    if(phase==='cancelled')(r.world as QueryWorld).clearQueries();
    const index=r.host.events.findIndex(e=>(e.meta?.serverQuery as Record<string,unknown> | undefined)?.requestId===requestId);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(r.host.events[index].meta?.serverQuery).toMatchObject({phase,goal_completed:false});
    expect(r.host.pushOpts[index]?.trigger).toBe(phase==='cancelled'?'piggyback':'debounce');
    await call(r,{requestId});
    if(phase!=='cancelled')await call(r,{query:'self'});
    expect(r.host.events.filter(e=>(e.meta?.serverQuery as Record<string,unknown> | undefined)?.requestId===requestId)).toHaveLength(1);
  });
});
