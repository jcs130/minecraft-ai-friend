import {EventEmitter} from 'node:events';
import {afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({children:[] as any[]}));
vi.mock('node:child_process',()=>({fork:vi.fn(()=>{
  const child=new EventEmitter() as any;
  Object.assign(child,{connected:true,exitCode:null,killed:false,pid:123,stdout:null,stderr:null,sent:[]});
  child.send=(message:any)=>{
    child.sent.push(message);
    if(message.t==='req' && message.req.kind==='shutdown')queueMicrotask(()=>{
      child.emit('message',{t:'rep',id:message.id,ok:true,value:null});
      child.exitCode=0;child.connected=false;child.emit('exit',0);
    });
  };
  child.kill=()=>{child.killed=true;child.exitCode=0;child.emit('exit',0);};
  state.children.push(child);return child;
})}));
import {MinecraftWorldProxy} from '../core/proxy.ts';
import {MINECRAFT_CLIENT_DEFAULTS} from '../src/client/config.ts';
import {FakeHost} from './method-host.ts';
import {MinecraftClientWorld} from '../src/client/world.ts';
afterEach(()=>{vi.useRealTimers();state.children.length=0;});
it('preserves typed route guards and journey facts through status IPC and the generic facade',async()=>{
  const cfg=structuredClone(MINECRAFT_CLIENT_DEFAULTS),proxy=new MinecraftWorldProxy({cfg}),host=new FakeHost();
  const started=proxy.start(host),child=state.children[0],init=child.sent.find((m:any)=>m.req?.kind==='init');
  child.emit('message',{t:'rep',id:init.id,ok:true,value:null});await started;
  const facts={text:'journey current',snapshotTypes:['minecraft.world.snapshot'],parts:[{key:'journey',text:'journey current'}],
    decisionStability:{sampledAtMs:Date.now(),identity:['realm','account'],dimension:'minecraft:overworld',position:[0,64,0],health:20,food:20,guards:{},
      route:{generation:7,positionEpoch:3,speedBlocksPerSec:4,policy:{choiceMinBlocks:10,choiceMaxBlocks:20,dangerChoiceMaxBlocks:5},risks:[],
        task:{id:44,stepIndex:0,stepCount:1,step:'goto',skill:'goto',resumable:true,destination:[128,64,0],dimension:'minecraft:overworld'},
        waiting:[],hold:null,goalOwner:'task',fighting:false,environment:null,windowOpen:false,cursorOccupied:false,
        footing:{kind:'support',block:'stone',grounded:true},entities:[],journeyId:'journey:7:44:0:1',journeyCues:[]}}};
  child.emit('message',JSON.parse(JSON.stringify({t:'note',note:{kind:'status',decl:{},storage:[],promptVars:{},requestFacts:facts}})));
  const facade=new MinecraftClientWorld({cfg},proxy);
  expect(proxy.requestFacts()?.decisionStability).toEqual(facts.decisionStability);
  expect(facade.requestFacts()?.decisionStability).toEqual(facts.decisionStability);
  expect(facade.requestFacts()?.parts?.find(p=>p.key==='journey')?.text).toBe('journey current');
  await proxy.stop();expect(facade.requestFacts()).toBeNull();
});
it('forwards fresh server readiness through the child proxy and expires missing or stale status without RPC',async()=>{
  vi.useFakeTimers();
  const proxy=new MinecraftWorldProxy({cfg:structuredClone(MINECRAFT_CLIENT_DEFAULTS)}),host=new FakeHost();
  const started=proxy.start(host),child=state.children[0],init=child.sent.find((m:any)=>m.req?.kind==='init');
  child.emit('message',{t:'rep',id:init.id,ok:true,value:null});await started;
  const status=(connection?:unknown)=>child.emit('message',{t:'note',note:{kind:'status',decl:{},storage:[],promptVars:{},requestFacts:null,connection}});
  expect(proxy.connectionReadiness()).toBeNull();
  status({ready:true,phase:'online',observedAt:Date.now(),deviceCode:'MUST_NOT_ESCAPE'});
  const sent=child.sent.length;
  expect(proxy.connectionReadiness()).toEqual({ready:true,phase:'online'});
  expect(child.sent).toHaveLength(sent);
  await vi.advanceTimersByTimeAsync(5100);
  expect(proxy.connectionReadiness()).toBeNull();
  status({ready:false,phase:'retrying',observedAt:Date.now()});
  expect(proxy.connectionReadiness()).toEqual({ready:false,phase:'retrying'});
  status();expect(proxy.connectionReadiness()).toBeNull();
  await proxy.stop();expect(proxy.connectionReadiness()).toBeNull();
});
it.each(['SIGINT','SIGTERM'])('does not auto-restart an interrupted child (%s)',async signal=>{
  vi.useFakeTimers();
  const proxy=new MinecraftWorldProxy({cfg:structuredClone(MINECRAFT_CLIENT_DEFAULTS)}),host=new FakeHost();
  const started=proxy.start(host),child=state.children[0],init=child.sent.find((m:any)=>m.req?.kind==='init');
  child.emit('message',{t:'rep',id:init.id,ok:true,value:null});await started;
  child.emit('exit',null,signal);
  await vi.advanceTimersByTimeAsync(10000);expect(state.children).toHaveLength(1);
  expect(host.events.some(e=>e.text.includes('崩了'))).toBe(false);await proxy.stop();
});
it('revokes a pending startup and ignores late IPC and exits from an older child',async()=>{
  const proxy=new MinecraftWorldProxy({cfg:structuredClone(MINECRAFT_CLIENT_DEFAULTS)});
  const host=new FakeHost(),starting=proxy.start(host);
  const cancelled=expect(starting).rejects.toThrow();
  const old=state.children[0],init=old.sent.find((m:any)=>m.req?.kind==='init');
  await proxy.stop();await cancelled;
  old.emit('message',{t:'rep',id:init.id,ok:true,value:null});
  old.emit('exit',1);
  vi.useFakeTimers();await vi.advanceTimersByTimeAsync(4000);expect(state.children).toHaveLength(1);
  const next=proxy.start(host),child=state.children[1],request=child.sent.find((m:any)=>m.req?.kind==='init');
  child.emit('message',{t:'rep',id:request.id,ok:true,value:null});await next;
  old.emit('exit',1);
  const controller=new AbortController(),pending=proxy.tools().find(t=>t.name==='mc_help')!.handler({}, {role:'host',log:host.log,signal:controller.signal,turnId:'t',round:3});
  const rejected=expect(pending).resolves.toMatchObject({failed:true,text:expect.stringContaining('cancelled')});
  controller.abort();await rejected;
  expect(child.sent).toEqual(expect.arrayContaining([expect.objectContaining({t:'cast',cast:expect.objectContaining({kind:'cancel'})})]));
  expect(child.sent.find((m:any)=>m.req?.kind==='tool').req).toMatchObject({turnId:'t',round:3});
  await proxy.stop();await vi.advanceTimersByTimeAsync(10000);expect(state.children).toHaveLength(2);
});
